import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { useToast } from '../../hooks/useToast.js';
import '../../pages/leader/leader.css';

/**
 * Muestra las cuentas de líder recién creadas al finalizar un mes (Fase 9),
 * con su contraseña temporal. Se muestran UNA sola vez: al cerrar el modal
 * ya no hay forma de volver a verlas (hay que reiniciar cada contraseña
 * desde «Accesos»).
 *
 * @param {{ accounts: Array<{personId,fullName,username,tempPassword}>|null, onClose: () => void }} props
 */
export function NewLeaderAccountsModal({ accounts, onClose }) {
  const { showSuccess } = useToast();
  if (!accounts || accounts.length === 0) return null;

  async function copyAll() {
    const text = accounts
      .map((a) => `${a.fullName}\n  usuario: ${a.username}\n  contraseña: ${a.tempPassword}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Credenciales copiadas al portapapeles.');
    } catch {
      /* sin portapapeles: el admin las copia a mano de la tabla */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Cuentas de líder creadas"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={copyAll}>
            Copiar todo
          </Button>
          <Button onClick={onClose}>Listo</Button>
        </>
      }
    >
      <p>
        Se crearon estas cuentas para que cada líder registre la asistencia de su equipo. Entregale
        a cada uno su usuario y contraseña. <strong>Las contraseñas no se vuelven a mostrar</strong>;
        si se pierde una, reiniciala desde «Accesos».
      </p>
      <table className="temp-credentials-table">
        <thead>
          <tr>
            <th scope="col">Líder</th>
            <th scope="col">Usuario</th>
            <th scope="col">Contraseña temporal</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.personId}>
              <td>{a.fullName}</td>
              <td>
                <code>{a.username}</code>
              </td>
              <td>
                <code>{a.tempPassword}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
