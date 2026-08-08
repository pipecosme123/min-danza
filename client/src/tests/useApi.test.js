import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useApi } from "../hooks/useApi.js";

// Regresión: un refetch después de que ya hubo datos (ej. tras bloquear una
// asignación, cambiar un uniforme, etc.) NO debe volver a poner `loading`
// en true. Si lo hiciera, cualquier pantalla que oculte su contenido
// mientras `loading` es true (la inmensa mayoría) desmontaría toda la vista
// en cada acción, sintiéndose como "la página se refresca y salta arriba".

describe("useApi — refetch tras la primera carga", () => {
  it("loading solo se activa en la primera carga, nunca en refetches posteriores", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useApi(fetcher, { immediate: true }));

    // Primera carga: loading pasa por true.
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 1 });

    // Refetch manual: loading debe permanecer en false todo el tiempo,
    // aunque la promesa todavía no se haya resuelto.
    fetcher.mockResolvedValueOnce({ value: 2 });
    let refetchPromise;
    act(() => {
      refetchPromise = result.current.execute();
    });
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await refetchPromise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ value: 2 });
  });

  it("un refetch que falla expone el error sin reactivar loading", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ value: 1 }).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useApi(fetcher, { immediate: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.execute()).rejects.toThrow("boom");
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    // Los datos previos siguen disponibles: un refetch fallido no debe
    // borrar lo último que se mostró correctamente.
    expect(result.current.data).toEqual({ value: 1 });
  });
});
