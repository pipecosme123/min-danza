import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './SearchableSelect.css';

/**
 * Quita diacríticos y normaliza mayúsculas/minúsculas para comparar texto sin
 * importar acentos, ej. "jose" debe encontrar "José".
 * @param {string} value
 */
function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const CLEAR_VALUE = '';

/**
 * Combobox de texto con autocompletado: un <input> que filtra una lista
 * desplegable de opciones a medida que se escribe (patrón combobox estándar
 * de ARIA), en vez de un <select> nativo largo para elegir sin poder buscar.
 * Reutilizable en cualquier pantalla que necesite elegir "una persona/cosa
 * entre muchas" con la misma apariencia que el resto del sistema de diseño
 * (usa las mismas clases `field__*` que `Field.jsx`).
 *
 * @param {{
 *   label: string,
 *   options: Array<{ value: string, label: string }>,
 *   value: string,
 *   onChange: (value: string) => void,
 *   placeholder?: string,
 *   clearLabel?: string,
 *   hint?: string,
 *   id?: string,
 * }} props
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Escribe para buscar...',
  clearLabel = 'Todas las opciones',
  hint,
  id,
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const listboxId = `${fieldId}-listbox`;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const [inputValue, setInputValue] = useState(selectedOption ? selectedOption.label : '');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);

  // Si `value` cambia desde afuera (ej. se limpia el filtro por otro medio),
  // sincronizamos el texto mostrado con la opción correspondiente.
  useEffect(() => {
    setInputValue(selectedOption ? selectedOption.label : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const filteredOptions = useMemo(() => {
    const query = normalize(inputValue.trim());
    if (!query) return options;
    return options.filter((option) => normalize(option.label).includes(query));
  }, [options, inputValue]);

  // La opción de limpiar siempre se muestra primero, seguida de las opciones
  // filtradas (o del mensaje de "sin coincidencias").
  const highlightableCount = filteredOptions.length + 1; // +1 por la opción de limpiar.

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex, open]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        closeList();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openList() {
    setOpen(true);
    setHighlightedIndex(-1);
  }

  function closeList() {
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function selectClear() {
    onChange(CLEAR_VALUE);
    setInputValue('');
    closeList();
    inputRef.current?.focus();
  }

  function selectOption(option) {
    onChange(option.value);
    setInputValue(option.label);
    closeList();
    inputRef.current?.focus();
  }

  function handleInputChange(event) {
    setInputValue(event.target.value);
    openList();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setHighlightedIndex((current) => (current + 1) % highlightableCount);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setHighlightedIndex((current) => (current - 1 + highlightableCount) % highlightableCount);
      return;
    }

    if (event.key === 'Enter') {
      if (!open || highlightedIndex === -1) return;
      event.preventDefault();
      if (highlightedIndex === 0) {
        selectClear();
      } else {
        const option = filteredOptions[highlightedIndex - 1];
        if (option) selectOption(option);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closeList();
      }
      return;
    }

    if (event.key === 'Tab') {
      closeList();
    }
  }

  const activeOptionId =
    open && highlightedIndex >= 0 ? `${fieldId}-option-${highlightedIndex}` : undefined;

  return (
    <div className="field searchable-select" ref={containerRef}>
      <label htmlFor={fieldId} className="field__label">
        {label}
      </label>

      <div className="searchable-select__control-wrapper">
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          role="combobox"
          className="field__control searchable-select__input"
          autoComplete="off"
          value={inputValue}
          placeholder={placeholder}
          onChange={handleInputChange}
          onFocus={openList}
          onClick={openList}
          onKeyDown={handleKeyDown}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-describedby={hintId}
        />

        {open ? (
          <ul id={listboxId} role="listbox" className="searchable-select__listbox" aria-label={label}>
            <li
              id={`${fieldId}-option-0`}
              role="option"
              aria-selected={value === CLEAR_VALUE}
              ref={(node) => {
                optionRefs.current[0] = node;
              }}
              className={`searchable-select__option searchable-select__option--clear${
                highlightedIndex === 0 ? ' searchable-select__option--highlighted' : ''
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                selectClear();
              }}
              onMouseEnter={() => setHighlightedIndex(0)}
            >
              {clearLabel}
            </li>

            {filteredOptions.length === 0 ? (
              <li className="searchable-select__empty" role="presentation">
                Sin coincidencias
              </li>
            ) : (
              filteredOptions.map((option, index) => (
                <li
                  key={option.value}
                  id={`${fieldId}-option-${index + 1}`}
                  role="option"
                  aria-selected={option.value === value}
                  ref={(node) => {
                    optionRefs.current[index + 1] = node;
                  }}
                  className={`searchable-select__option${
                    highlightedIndex === index + 1 ? ' searchable-select__option--highlighted' : ''
                  }${option.value === value ? ' searchable-select__option--selected' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectOption(option);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index + 1)}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
