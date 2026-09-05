import { describe, expect, it } from "vitest";
import { formatMoney, formatPricePerMillion, localizeRuntimeText, platformName, providerLabel, reasoningLabel, starterCommands, translate } from "./i18n";

describe("renderer localization", () => {
  it("translates interface text and numeric placeholders for Persian", () => {
    expect(translate("fa", "Step {step} / {actions} actions", { step: 2, actions: 7 })).toBe("مرحلهٔ ۲ / ۷ عمل");
    expect(translate("fa", "The desktop bridge is available inside Electron only.")).toContain("Electron");
    expect(reasoningLabel("fa", "provider-default")).toBe("پیش‌فرض ارائه‌دهنده");
  });

  it("formats money and model pricing in the selected locale", () => {
    expect(formatMoney("fa", 1.25)).toBe("۱٫۲۵۰۰ دلار");
    expect(formatPricePerMillion("fa", 0.000002)).toContain("۲٫۰۰ دلار / ۱ میلیون توکن");
    expect(formatMoney("en", 1.25)).toBe("$1.2500");
  });

  it("localizes platform and provider labels while keeping product names intact", () => {
    expect(platformName("fa", "browser-preview")).toBe("پیش‌نمایش مرورگر");
    expect(providerLabel("fa", "vercel-gateway")).toBe("درگاه هوش مصنوعی Vercel");
    expect(providerLabel("en", "custom-openai-compatible")).toBe("Custom endpoint");
  });

  it("localizes runtime activity without exposing typed content", () => {
    expect(localizeRuntimeText("fa", "Opening Notepad")).toBe("در حال باز کردن Notepad");
    expect(localizeRuntimeText("fa", "Type secret text into Password Manager")).toBe("در حال وارد کردن متن در Password Manager");
  });

  it("uses Persian starter commands for both supported platforms", () => {
    expect(starterCommands("fa", "win32")[0]).toContain("نوت‌پد");
    expect(starterCommands("fa", "darwin")[0]).toContain("TextEdit");
    expect(starterCommands("en", "win32")[0]).toContain("Notepad");
  });
});
