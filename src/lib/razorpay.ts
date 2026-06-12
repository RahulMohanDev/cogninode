// src/lib/razorpay.ts
// Razorpay Checkout loader + a typed wrapper around window.Razorpay. The
// script tag is injected once (StrictMode-safe promise guard); checkout
// options are built here so the modal stays free of Razorpay specifics.

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
}

type RazorpayConstructor = new (options: {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { email?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loader: Promise<boolean> | null = null;

export function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;
  loader = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      loader = null; // allow a retry after a network failure
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return loader;
}

export interface CheckoutParams {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  email?: string;
  onSuccess: (r: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    signature: string;
  }) => void;
  onDismiss: () => void;
}

/** Opens the Razorpay checkout sheet. Resolves once it has OPENED (or
 *  throws if the script can't load) — payment outcome flows through the
 *  onSuccess/onDismiss callbacks. */
export async function openCheckout(params: CheckoutParams): Promise<void> {
  const ok = await loadCheckoutScript();
  if (!ok || !window.Razorpay) {
    throw new Error("Couldn't load the payment window — check your connection and try again.");
  }
  const instance = new window.Razorpay({
    key: params.keyId,
    order_id: params.orderId,
    amount: params.amountPaise,
    currency: params.currency,
    name: "cogninode",
    description: "Credit pack",
    ...(params.email ? { prefill: { email: params.email } } : {}),
    handler: (r) =>
      params.onSuccess({
        razorpayOrderId: r.razorpay_order_id,
        razorpayPaymentId: r.razorpay_payment_id,
        signature: r.razorpay_signature,
      }),
    modal: { ondismiss: params.onDismiss },
  });
  instance.open();
}
