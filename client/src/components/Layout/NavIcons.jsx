/**
 * Íconos de línea para la navegación (SVG en línea, sin dependencias).
 * Siempre decorativos: el texto de cada enlace es el que da el nombre
 * accesible, por eso todos llevan `aria-hidden`.
 */
function Icon({ children }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PeopleIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14a6.5 6.5 0 0 1 3.5 6" />
    </Icon>
  );
}

export function TeamsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M7 20a5 5 0 0 1 10 0" />
      <path d="M1.5 18a3.5 3.5 0 0 1 4.5-3.3" />
      <path d="M22.5 18a3.5 3.5 0 0 0-4.5-3.3" />
    </Icon>
  );
}

export function CalendarIcon() {
  return (
    <Icon>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </Icon>
  );
}

export function UniformIcon() {
  return (
    <Icon>
      <path d="M8.5 3 3 6l2 4.5 2.5-1V21h9V9.5l2.5 1L21 6l-5.5-3a3.5 3.5 0 0 1-7 0Z" />
    </Icon>
  );
}

export function AttendanceIcon() {
  return (
    <Icon>
      <rect x="5" y="3.5" width="14" height="18" rx="2.5" />
      <path d="M9 3.5h6v2.5H9z" />
      <path d="m8.5 13 2.5 2.5 4.5-5" />
    </Icon>
  );
}

export function KeyIcon() {
  return (
    <Icon>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.5 11.5 9-9M17 6l3 3M14.5 8.5l2 2" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </Icon>
  );
}

export function LogoutIcon() {
  return (
    <Icon>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" />
    </Icon>
  );
}
