import logging
import os
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.ai import rule_engine, claude_narrator
from app.ai.rule_engine import SignalValues
from app.models.account import Account, ChurnRiskTier
from app.models.health_score_log import HealthScoreLog, ScoreTrigger
from app.models.activity import Activity, ActivityType
from app.models.survey import Survey, SurveyType
from app.models.scoring_config import ScoringConfig, DEFAULT_WEIGHTS

logger = logging.getLogger(__name__)

# Module-level ML model instance (loaded once at startup)
try:
    from app.ai.ml_model import MLModel
    _ML_MODELS_DIR = os.path.join(os.path.dirname(__file__), "../../ml_models")
    _ml_model = MLModel(models_dir=_ML_MODELS_DIR)
except Exception as e:
    logger.warning(f"Could not initialize ML model: {e}")
    _ml_model = None


def get_ml_model():
    """Return the shared MLModel instance (may be None if import failed)."""
    return _ml_model


class ChurnEngine:
    async def run(self, account_id: int, db: AsyncSession, force_narrative: bool = False) -> dict | None:
        account = await db.get(Account, account_id)
        if not account:
            return None

        weights = await self._load_weights(db)
        signals = await self._build_signals(account, db)
        rule_result = rule_engine.calculate(signals, weights)

        ml_result = None
        if _ml_model:
            avg_30, avg_60, avg_90 = await self._compute_score_averages(account_id, db)
            features = self._build_ml_features(account, signals, avg_30, avg_60, avg_90)
            ml_result = _ml_model.predict(features)

        if ml_result:
            final_score = rule_result.rule_score * 0.4 + ml_result.ml_probability * 100 * 0.6
        else:
            final_score = rule_result.rule_score
        final_score = round(final_score, 2)

        prev_score = account.health_score or 50
        score_delta = abs(final_score - prev_score)
        should_narrate = force_narrative or score_delta > 10

        ai_narrative = None
        if should_narrate:
            notes, nps_scores, playbook_count = await self._gather_narrative_context(account_id, db)
            days_to_renewal = self._days_to_renewal(account)
            ai_narrative = claude_narrator.generate(
                tier=account.tier.value,
                arr=float(account.arr) if account.arr else None,
                days_to_renewal=days_to_renewal,
                signal_scores=rule_result.signal_scores,
                weights=weights,
                ml_result=ml_result,
                open_tasks=await self._count_open_tasks(account_id, db),
                high_priority_tasks=signals.open_high_priority_tasks,
                nps_scores=nps_scores,
                notes=notes,
                playbook_trigger_count=playbook_count,
            )

        churn_risk_tier = ChurnRiskTier(rule_result.churn_risk_tier)
        log = HealthScoreLog(
            account_id=account_id,
            score=int(final_score),
            rule_score=int(rule_result.rule_score),
            ml_score=ml_result.ml_probability if ml_result else None,
            ml_confidence=None,
            ai_narrative=ai_narrative,
            triggered_by=ScoreTrigger.auto,
            created_at=datetime.now(timezone.utc),
        )
        db.add(log)
        account.health_score = int(final_score)
        account.churn_risk_tier = churn_risk_tier
        await db.commit()

        return {
            "final_score": final_score,
            "rule_score": rule_result.rule_score,
            "signal_scores": rule_result.signal_scores,
            "churn_risk_tier": churn_risk_tier.value,
            "ml_probability": ml_result.ml_probability if ml_result else None,
            "ml_top_features": ml_result.top_features if ml_result else None,
            "ai_narrative": ai_narrative,
        }

    async def _load_weights(self, db: AsyncSession) -> dict[str, float]:
        result = await db.execute(select(ScoringConfig))
        rows = result.scalars().all()
        if not rows:
            return DEFAULT_WEIGHTS.copy()
        return {row.signal_name: row.weight for row in rows}

    def _days_to_renewal(self, account: Account) -> int:
        if not account.renewal_date:
            return 365
        from datetime import date
        delta = account.renewal_date - date.today()
        return max(delta.days, 0)

    async def _build_signals(self, account: Account, db: AsyncSession) -> SignalValues:
        # Days since last CSM activity (note type)
        last_activity = await db.execute(
            select(func.max(Activity.created_at))
            .where(Activity.account_id == account.id, Activity.type == ActivityType.note)
        )
        last_dt = last_activity.scalar_one_or_none()
        if last_dt:
            last_dt_aware = last_dt.replace(tzinfo=timezone.utc) if last_dt.tzinfo is None else last_dt
            days_since = (datetime.now(timezone.utc) - last_dt_aware).days
        else:
            days_since = 999

        # Latest NPS score
        latest_nps_row = await db.execute(
            select(Survey.score)
            .where(Survey.account_id == account.id, Survey.type == SurveyType.nps)
            .order_by(Survey.submitted_at.desc())
            .limit(1)
        )
        latest_nps = latest_nps_row.scalar_one_or_none()

        # Open high-priority tasks count
        from app.models.task import Task, TaskStatus, TaskPriority
        task_count = await db.execute(
            select(func.count()).where(
                Task.account_id == account.id,
                Task.status == TaskStatus.open,
                Task.priority == TaskPriority.high,
            )
        )
        open_high = task_count.scalar_one()

        return SignalValues(
            days_since_activity=days_since,
            days_to_renewal=self._days_to_renewal(account),
            open_high_priority_tasks=open_high,
            latest_nps=latest_nps,
            ticket_trend=account.ticket_trend or 3,
            csm_sentiment=account.csm_sentiment or 3,
        )

    async def _compute_score_averages(self, account_id: int, db: AsyncSession) -> tuple[float, float, float]:
        from datetime import date
        now = datetime.now(timezone.utc)
        async def avg_for_days(days: int) -> float:
            cutoff = now - timedelta(days=days)
            result = await db.execute(
                select(func.avg(HealthScoreLog.score))
                .where(HealthScoreLog.account_id == account_id, HealthScoreLog.created_at >= cutoff)
            )
            val = result.scalar_one_or_none()
            return float(val) if val is not None else 50.0
        avg_30 = await avg_for_days(30)
        avg_60 = await avg_for_days(60)
        avg_90 = await avg_for_days(90)
        return avg_30, avg_60, avg_90

    async def _count_open_tasks(self, account_id: int, db: AsyncSession) -> int:
        from app.models.task import Task, TaskStatus
        result = await db.execute(
            select(func.count()).where(
                Task.account_id == account_id,
                Task.status == TaskStatus.open,
            )
        )
        return result.scalar_one()

    def _build_ml_features(self, account: Account, signals: SignalValues, avg_30: float = 50.0, avg_60: float = 50.0, avg_90: float = 50.0) -> dict:
        tier_map = {"smb": 0, "mid_market": 1, "enterprise": 2}
        arr = float(account.arr) if account.arr else 0
        arr_band = 0 if arr < 50_000 else (1 if arr < 200_000 else 2)
        return {
            "days_since_activity": signals.days_since_activity,
            "days_to_renewal": signals.days_to_renewal,
            "open_high_priority_tasks": signals.open_high_priority_tasks,
            "latest_nps": signals.latest_nps or 5,
            "ticket_trend": signals.ticket_trend,
            "csm_sentiment": signals.csm_sentiment,
            "account_age_days": 365,
            "tier_encoded": tier_map.get(account.tier.value, 0),
            "arr_band_encoded": arr_band,
            "avg_score_30d": avg_30,
            "avg_score_60d": avg_60,
            "avg_score_90d": avg_90,
        }

    async def _gather_narrative_context(self, account_id: int, db: AsyncSession):
        notes_result = await db.execute(
            select(Activity.content)
            .where(Activity.account_id == account_id, Activity.type == ActivityType.note,
                   Activity.content.isnot(None))
            .order_by(Activity.created_at.desc())
            .limit(5)
        )
        notes = [r[0] for r in notes_result.all()]

        nps_result = await db.execute(
            select(Survey.score)
            .where(Survey.account_id == account_id, Survey.type == SurveyType.nps,
                   Survey.score.isnot(None))
            .order_by(Survey.submitted_at.desc())
            .limit(3)
        )
        nps_scores = [r[0] for r in nps_result.all()]

        from app.models.playbook import PlaybookRun
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        pb_result = await db.execute(
            select(func.count()).where(
                PlaybookRun.account_id == account_id,
                PlaybookRun.triggered_at >= cutoff,
            )
        )
        playbook_count = pb_result.scalar_one()

        return notes, nps_scores, playbook_count
