export type IconName =
  | "folder"
  | "page"
  | "tasks"
  | "search"
  | "star"
  | "clock"
  | "trash"
  | "computer"
  | "plus"
  | "arrow"
  | "settings"
  | "board"
  | "list"
  | "save";
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    folder: (
      <>
        <path fill="#e8b945" d="M2 6h8l2 3h10v12H2z" />
        <path fill="#fff0a3" d="M2 6h8l2 3H2z" />
        <path fill="#f5d26c" d="M3 11h20l-3 10H2z" />
      </>
    ),
    page: (
      <>
        <path fill="#fff" d="M5 2h10l5 5v15H5z" />
        <path fill="#b7cddd" d="M15 2v6h5" />
        <path d="M8 11h9M8 14h9M8 17h6" />
      </>
    ),
    tasks: (
      <>
        <path fill="#fff" d="M4 3h17v19H4z" />
        <path fill="#7aa5c6" d="M8 1h9v5H8z" />
        <path d="m7 11 2 2 3-4m1 3h5M7 17h3m3 0h5" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" fill="#c4e9eb" />
        <path strokeWidth="4" d="m15 15 7 7" />
      </>
    ),
    star: (
      <path fill="#f5d26c" d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z" />
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" fill="#fff" />
        <path d="M12 5v8h6" />
      </>
    ),
    trash: (
      <>
        <path fill="#ddd" d="m5 7 2 15h11l2-15z" />
        <path d="M3 6h19M9 3h7M10 10v8m5-8v8" />
      </>
    ),
    computer: (
      <>
        <path fill="#c0c0c0" d="M2 2h21v16H2z" />
        <path fill="#008080" d="M5 5h15v10H5z" />
        <path fill="#bbb" d="M9 18h7v3h5v2H4v-2h5z" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    arrow: <path d="m8 4 8 8-8 8" />,
    settings: (
      <>
        <path
          fill="#bbb"
          d="m10 2 4 0 1 4 4-1 2 4-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-4 4 1z"
        />
        <circle cx="12" cy="12" r="4" fill="#fff" />
      </>
    ),
    board: (
      <>
        <path fill="#c6d9e8" d="M2 3h6v18H2zm8 0h6v18h-6zm8 0h5v18h-5z" />
        <path d="M3 7h4m4 0h4m4 0h3" />
      </>
    ),
    list: (
      <>
        <path fill="#fff" d="M2 3h21v18H2z" />
        <path d="M5 7h2m3 0h10M5 12h2m3 0h10M5 17h2m3 0h10" />
      </>
    ),
    save: (
      <>
        <path fill="#7a9bcd" d="M3 2h16l3 3v18H3z" />
        <path fill="#fff" d="M7 2h10v7H7zm0 12h12v9H7z" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 25 25"
      fill="none"
      stroke="#293238"
      strokeWidth="1.3"
      strokeLinejoin="miter"
    >
      {paths[name]}
    </svg>
  );
}
