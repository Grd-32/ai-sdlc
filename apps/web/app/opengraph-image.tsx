import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Nomalog security and governance for AI-assisted software";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "#171a20",
        color: "#f8fafc",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "18px",
          color: "#fdba74",
          fontSize: 24,
          fontWeight: 600,
        }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#ea580c" }} />
        NOMALOG
        <span style={{ color: "#94a3b8", fontSize: 21 }}>SECURITY &amp; GOVERNANCE</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ maxWidth: 950, fontSize: 72, lineHeight: 1.08, fontWeight: 700 }}>
          Know the security risks in your AI-assisted code.
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 26 }}>
          Risk · policy · human review · evidence
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 20 }}>nomalog</div>
    </div>,
    size,
  );
}
