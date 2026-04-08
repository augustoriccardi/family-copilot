import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(apiKey);
  }
  return _resend;
}

const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? "Family Copilot <noreply@family-copilot.app>";

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const { data, error } = await getResend().emails.send({
    from: FROM_ADDRESS,
    to: args.to,
    subject: args.subject,
    text: args.text,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  if (!data?.id) throw new Error("Resend returned no email ID");
}
