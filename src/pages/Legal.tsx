// src/pages/Legal.tsx
// Static legal page: privacy, terms, refunds, contact — required for
// Razorpay merchant KYC and basic consumer-protection hygiene.
// ⚠ REVIEW BEFORE LAUNCH: this is a good-faith draft, not legal advice.
// Replace the contact address and have the GST/refund language checked.

const SECTION = "tw:max-w-[72ch] tw:mb-10";
const H2 = "tw:font-display tw:font-semibold tw:text-[22px] tw:tracking-[-0.015em] tw:mt-0 tw:mb-3";
const P = "tw:text-ink-2 tw:text-[14.5px] tw:leading-[1.65] tw:my-2";

export default function Legal() {
  return (
    <div className="tw:min-h-dvh tw:bg-bg tw:overflow-y-auto">
      <div className="tw:max-w-[820px] tw:mx-auto tw:px-8 tw:py-12">
        <a href="/" className="tw:text-ink-3 tw:text-[13px] tw:hover:text-ink">← back to cogninode</a>
        <h1 className="tw:font-display tw:font-semibold tw:text-[34px] tw:tracking-[-0.02em] tw:mt-4 tw:mb-10">
          Privacy, terms & refunds
        </h1>

        <section id="privacy" className={SECTION}>
          <h2 className={H2}>Privacy</h2>
          <p className={P}>
            cogninode is local-first: your chats, knowledge graphs, reflections,
            and uploaded files live in your browser's own storage (IndexedDB).
          </p>
          <p className={P}>
            When you sign in, your account email (via Clerk, our sign-in
            provider) and your payment records (via Razorpay) are stored on our
            backend. When sync is active, your chats, graphs, reflections, and
            files are also mirrored to our backend (Convex) so they can back up
            and follow you across devices. We don't sell your data or use it to
            train models.
          </p>
          <p className={P}>
            Messages you send are forwarded to the AI model you selected via
            OpenRouter and are subject to the upstream provider's data policy.
          </p>
          <p className={P}>
            You can export everything as JSON at any time (Settings → Export),
            and delete your account — which removes your synced data, disables
            your access key, and erases your sign-in — from Settings.
          </p>
        </section>

        <section id="terms" className={SECTION}>
          <h2 className={H2}>Terms</h2>
          <p className={P}>
            cogninode sells prepaid credits that can only be spent on AI chat
            inside cogninode. Credits are not money: they can't be cashed out,
            transferred, or spent anywhere else. Credits don't expire.
          </p>
          <p className={P}>
            Each reply deducts credits based on the actual upstream cost of the
            model that produced it; the estimate is shown before you send and
            the exact amount under each reply. Abuse (resale, automated
            scraping, attempts to extract keys or exceed fair use) can lead to
            account suspension.
          </p>
        </section>

        <section id="refunds" className={SECTION}>
          <h2 className={H2}>Refunds & cancellations</h2>
          <p className={P}>
            Credit purchases are one-time payments (no subscription, nothing
            recurring to cancel). Spent credits are non-refundable. If a
            payment was charged but credits never arrived, contact us within 7
            days and we'll either restore the credits or refund the payment in
            full to the original method.
          </p>
        </section>

        <section id="contact" className={SECTION}>
          <h2 className={H2}>Contact</h2>
          <p className={P}>
            Questions, billing problems, data requests:{" "}
            <a className="tw:text-ink tw:underline tw:underline-offset-[3px]" href="mailto:mohanrahul93@gmail.com">
              mohanrahul93@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
