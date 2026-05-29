// src/components/setup/ApiKeyGate.tsx
// Wraps the app: when a verified OpenRouter key is stored, renders the app;
// otherwise shows the setup screen. The screen's two halves live in their
// own components — SetupHero (left flavour) and ApiKeyForm (right form +
// validation) — and this gate just composes them inside the page shell.

import { type ReactNode } from "react";
import { useSettings } from "../../hooks/useSettings";
import { SetupHero } from "./SetupHero";
import { ApiKeyForm } from "./ApiKeyForm";

export interface ApiKeyGateProps {
    children: ReactNode;
}

export function ApiKeyGate({ children }: ApiKeyGateProps) {
    const { apiKey } = useSettings();

    if (apiKey) return <>{children}</>;

    return (
        <div className="auth-page key-gate">
            <SetupHero />
            <ApiKeyForm />
        </div>
    );
}

export default ApiKeyGate;
