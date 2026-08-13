"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function ShareActions({
  url,
  label,
  proof,
  printable = false,
}: {
  url: string;
  label: string;
  proof?: string;
  printable?: boolean;
}) {
  const [qr, setQr] = useState<string>();

  useEffect(() => {
    if (!printable) return;
    let active = true;
    void QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#172016", light: "#ffffff" },
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => { active = false; };
  }, [printable, url]);

  const message = `Please review ${label}${proof ? ` (proof ${proof})` : ""}: ${url}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <div className={printable ? "share-actions printable-share" : "share-actions"}>
      {printable && qr && (
        <figure className="cut-card-qr">
          {/* Generated locally from the current bearer URL; never sent to a QR service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code linking to this exact Cut Card" width="120" height="120" />
          <figcaption>Scan this exact Cut Card</figcaption>
        </figure>
      )}
      <div className="share-action-buttons">
        <a className="button whatsapp" href={whatsapp} target="_blank" rel="noreferrer">
          Send on WhatsApp
        </a>
        {printable && (
          <button type="button" className="button secondary" onClick={() => window.print()}>
            Print Cut Card
          </button>
        )}
      </div>
      <small>Anyone with this private bearer link can open the review until it expires or is revoked.</small>
    </div>
  );
}
