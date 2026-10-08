/** The WED wordmark: the name set in the display serif, nothing else. */
export default function Wordmark({ className = "" }: { className?: string }) {
	return (
		<span dir="ltr" className={`text-[1.75rem] leading-none tracking-[-0.02em] ${className}`} style={{ fontFamily: "var(--font-display-face), serif" }}>
			WED
		</span>
	);
}
