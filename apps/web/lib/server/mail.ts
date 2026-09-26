// Email delivery port (leaf-1.4.1 ADR-4; R2-ADM-1/2): SMTP through nodemailer when EMAIL_SERVER
// and EMAIL_FROM are set. Without them, email-only features answer 503 `email_not_configured`.
import nodemailer from "nodemailer";
import { ProblemError } from "./problem";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export const emailNotConfigured = () =>
  new ProblemError(
    503,
    "email_not_configured",
    "email is not configured on this server (EMAIL_SERVER, EMAIL_FROM)",
  );

export function smtpMailer(server: string, from: string): Mailer {
  const transport = nodemailer.createTransport(server);
  return {
    configured: true,
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

export const noMailer: Mailer = {
  configured: false,
  send() {
    return Promise.reject(emailNotConfigured());
  },
};

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const server = env.EMAIL_SERVER;
  const from = env.EMAIL_FROM;
  return server !== undefined && server !== "" && from !== undefined && from !== ""
    ? smtpMailer(server, from)
    : noMailer;
}
