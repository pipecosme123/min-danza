import { useId, useState } from 'react';
import './PageHeader.css';

/**
 * Encabezado de pantalla: título + botón de ayuda circular «i».
 *
 * La descripción de la pantalla queda oculta por defecto (se lee una vez y
 * después solo ocupa espacio) y se despliega/oculta con el botón «i», que es
 * un disclosure accesible (`aria-expanded` + `aria-controls`), no un tooltip:
 * funciona igual con teclado, lector de pantalla y en el celular, donde no
 * hay hover.
 *
 * @param {{ title: import('react').ReactNode, description?: import('react').ReactNode }} props
 */
export function PageHeader({ title, description, children }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

  return (
    <header className="page-header">
      <div className="page-header__title-row">
        <h1>{title}</h1>
        {description ? (
          <button
            type="button"
            className={`help-button${helpOpen ? ' help-button--active' : ''}`}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-label={helpOpen ? 'Ocultar ayuda de esta pantalla' : 'Ver ayuda de esta pantalla'}
            title={helpOpen ? 'Ocultar ayuda' : 'Ayuda'}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <span aria-hidden="true">i</span>
          </button>
        ) : null}
      </div>
      {description ? (
        <div id={helpId} className="page-header__help" hidden={!helpOpen}>
          <p className="page-header__description">{description}</p>
        </div>
      ) : null}
      {children}
    </header>
  );
}
