export function AniScrollLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="1.5" y="1.5" width="33" height="33" rx="6" fill="#111111" stroke="#FFFFFF" strokeWidth="1.5" />
      <path
        d="M11 10.5H21.5C23.9853 10.5 26 12.5147 26 15V25.5H15.5C13.0147 25.5 11 23.4853 11 21V10.5Z"
        stroke="#FFFFFF"
        strokeWidth="1.75"
      />
      <path d="M15 15.5H22M15 20H19.5" stroke="#A0A0A0" strokeWidth="1.5" strokeLinecap="square" />
      <circle cx="24" cy="12" r="2" fill="#FFFFFF" />
    </svg>
  );
}
