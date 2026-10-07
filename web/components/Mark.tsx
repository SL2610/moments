// Halftone Guest: one dot printed large among the crowd (the WED mark).
const DOTS = [
	[4.6, 4.6, 4.6],
	[23.6, 4.6, 4.6],
	[42.6, 4.6, 4.6],
	[61.6, 4.6, 4.6],
	[80.6, 4.6, 4.6],
	[14.1, 21.05, 4.6],
	[33.1, 21.05, 4.6],
	[52.1, 21.05, 9.4],
	[71.1, 21.05, 4.6],
	[4.6, 37.51, 4.6],
	[23.6, 37.51, 4.6],
	[42.6, 37.51, 4.6],
	[61.6, 37.51, 4.6],
	[80.6, 37.51, 4.6],
];

export default function Mark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 85.2 42.11" aria-hidden="true" className={className}>
			{DOTS.map(([cx, cy, r]) => (
				<circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" />
			))}
		</svg>
	);
}
