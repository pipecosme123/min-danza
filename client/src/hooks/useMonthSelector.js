import { useEffect, useState } from 'react';
import { getMonths } from '../api/months.js';
import { useApi } from './useApi.js';

/**
 * Selector de "mes en curso" reutilizado por las pantallas administrativas
 * que operan sobre un `MonthCycle` (`TeamGenerator`, `EventsManager`, ...).
 * Carga la lista de meses una sola vez, mantiene cuál está seleccionado
 * (por defecto el primero, el más reciente) y resuelve el objeto completo
 * del mes elegido — evita repetir este mismo bloque de estado en cada
 * pantalla que necesita "elegir un mes primero".
 */
export function useMonthSelector() {
  const { data: monthsData, loading: monthsLoading, error: monthsError, execute: fetchMonths } = useApi(getMonths, {
    immediate: true,
  });
  const months = monthsData?.data ?? [];

  const [selectedMonthId, setSelectedMonthId] = useState('');

  useEffect(() => {
    if (!selectedMonthId && months.length > 0) {
      setSelectedMonthId(months[0].id);
    }
    // Solo se dispara cuando cambia la lista de meses (ej. al crear uno
    // nuevo o al terminar de cargar); `selectedMonthId` se lee, no se
    // observa, para no pisar una selección manual del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);

  const effectiveMonthId = selectedMonthId || months[0]?.id || '';
  const selectedMonth = months.find((m) => m.id === effectiveMonthId) || null;

  return {
    months,
    monthsLoading,
    monthsError,
    fetchMonths,
    selectedMonthId: effectiveMonthId,
    setSelectedMonthId,
    selectedMonth,
  };
}
