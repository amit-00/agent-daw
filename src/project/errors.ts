export type DomainErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "limit_exceeded";

export interface DomainErrorInfo {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly relatedIds?: readonly string[];
  readonly batchIndex?: number;
}

export class DomainError extends Error {
  readonly info: DomainErrorInfo;

  constructor(info: DomainErrorInfo) {
    super(info.message);
    this.name = new.target.name;
    this.info = info;
  }
}

type ErrorDetails = Omit<DomainErrorInfo, "code">;

export class InvalidInputError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "invalid_input" });
  }
}

export class NotFoundError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "not_found" });
  }
}

export class ConflictError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "conflict" });
  }
}

export class LimitExceededError extends DomainError {
  constructor(details: ErrorDetails) {
    super({ ...details, code: "limit_exceeded" });
  }
}
