import { PieChart, Pie, Cell } from 'recharts'

function tierColor(score: number): string {
  if (score >= 70) return '#16a34a'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

export default function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const data = [{ value: clamped }, { value: 100 - clamped }]
  const color = tierColor(clamped)

  return (
    <div className="flex flex-col items-center">
      <PieChart width={160} height={90}>
        <Pie
          data={data}
          startAngle={180}
          endAngle={0}
          innerRadius={50}
          outerRadius={70}
          dataKey="value"
          strokeWidth={0}
        >
          <Cell fill={color} />
          <Cell fill="#e5e7eb" />
        </Pie>
      </PieChart>
      <div className="text-3xl font-bold -mt-6" style={{ color }}>
        {clamped}
      </div>
      <div className="text-xs text-gray-500 mt-1">Health Score</div>
    </div>
  )
}
