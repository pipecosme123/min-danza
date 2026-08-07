// Clases de error de dominio. `errorHandler.js` las usa para decidir qué
// exponer al cliente y con qué status code, sin filtrar detalles internos.

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {Record<string, any>} [details]
   */
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class HttpError extends AppError {
  constructor(statusCode, message, details) {
    super(message, statusCode, details);
    this.name = "HttpError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Recurso no encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "No autenticado") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "No autorizado") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends HttpError {
  constructor(message = "Datos inválidos", details) {
    super(400, message, details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflicto con el estado actual del recurso", details) {
    super(409, message, details);
    this.name = "ConflictError";
  }
}
