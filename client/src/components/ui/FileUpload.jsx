import { useId, useState } from 'react';
import './FileUpload.css';

/**
 * Selector de archivo accesible (para la carga masiva de personas por
 * CSV/Excel). El <input type="file"> real permanece interactivo y
 * enfocable (superpuesto e invisible, no `display:none`) para conservar
 * foco de teclado visible y el diálogo nativo del sistema operativo;
 * el <label> le da la apariencia de botón.
 *
 * @param {{ label: string, accept?: string, hint?: string, onFileSelected: (file: File|null) => void }} props
 */
export function FileUpload({ label, accept, hint, onFileSelected, id }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const [fileName, setFileName] = useState(null);

  function handleChange(event) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
    onFileSelected?.(file);
  }

  return (
    <div className="file-upload">
      <div className="file-upload__control">
        <label htmlFor={fieldId} className="file-upload__button">
          {label}
        </label>
        <input
          id={fieldId}
          type="file"
          accept={accept}
          className="file-upload__input"
          onChange={handleChange}
          aria-describedby={hintId}
        />
      </div>

      <p className="file-upload__status">
        {fileName ? `Archivo seleccionado: ${fileName}` : 'Ningún archivo seleccionado todavía.'}
      </p>

      {hint ? (
        <p id={hintId} className="file-upload__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
