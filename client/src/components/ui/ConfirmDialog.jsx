import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';

/**
 * Variante de `Modal` para confirmar acciones importantes o destructivas
 * (ej. "Volver a sortear equipos", "Eliminar evento"). Al ser una
 * composición de `Modal`, puede sustituirlo en cualquier lugar que espere
 * un diálogo (principio de sustitución de Liskov aplicado a UI).
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onConfirm: () => void,
 *   title: string,
 *   description: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   variant?: 'primary'|'danger',
 *   loading?: boolean,
 * }} props
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'primary',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{description}</p>
    </Modal>
  );
}
