import { InvalidArgumentError } from "commander";

/**
 * Commander custom option-parser for --port. Validates before the action
 * handler runs at all, so an invalid port never reaches http.Server.listen().
 */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError(
      "port must be an integer between 0 and 65535.",
    );
  }
  return port;
}
