"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import SampleCutCard from "./SampleCutCard";

type CutCardEntryProps = {
  privateIntakeHref: string;
  signedIn: boolean;
  initialSource?: "choose" | "sample";
};

export default function CutCardEntry({
  privateIntakeHref,
  signedIn,
  initialSource = "choose",
}: CutCardEntryProps) {
  const [source, setSource] = useState<"choose" | "sample">(initialSource);

  if (source === "sample") {
    return (
      <div id="workspace" className="sample-workspace">
        <SampleCutCard
          onChangeSource={() => {
            window.history.replaceState(null, "", "/create");
            setSource("choose");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          privateIntakeHref={privateIntakeHref}
        />
      </div>
    );
  }

  return (
    <section className="create-entry" aria-labelledby="create-title">
      <header className="create-entry-header">
        <p className="eyebrow">Create a Cut Card</p>
        <h1 id="create-title">How would you like to start?</h1>
        <p>
          Choose the ready sample to explore PatternProof, or use private photos to create
          a real Cut Card. You can change paths before uploading anything.
        </p>
      </header>

      <div className="source-grid" aria-label="Choose an image source">
        <button
          className="source-card source-card-sample"
          type="button"
          onClick={() => {
            window.history.replaceState(null, "", "/create?source=sample");
            setSource("sample");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <div className="source-visual source-thumbnails" aria-hidden="true">
            <Image src="/demo/reference-olive.jpg" alt="" width={230} height={280} priority />
            <Image src="/demo/render-olive.jpg" alt="" width={230} height={280} priority />
          </div>
          <div className="source-card-copy">
            <div className="source-card-meta">
              <span className="source-kicker">Ready sample</span>
              <span className="source-badge">Recommended first</span>
            </div>
            <h2>Explore with sample photos</h2>
            <p>Walk through preview, feasibility, revision, approval, and privacy controls.</p>
            <ul>
              <li>Recorded YouCam result included</li>
              <li>Nothing is uploaded or saved</li>
            </ul>
            <strong className="source-action">Explore the sample <span aria-hidden="true">â†’</span></strong>
          </div>
        </button>

        <Link className="source-card source-card-private" href={privateIntakeHref}>
          <div className="source-visual private-source-visual" aria-hidden="true">
            <span>01</span><i></i><span>02</span>
            <strong>Customer photo + garment reference</strong>
          </div>
          <div className="source-card-copy">
            <div className="source-card-meta">
              <span className="source-kicker">Private workspace</span>
              <span className="source-badge">{signedIn ? "Signed in" : "Sign-in required"}</span>
            </div>
            <h2>Create with my photos</h2>
            <p>Upload a real image pair and generate a private YouCam visual-intent preview.</p>
            <ul>
              <li>Consent and image rights required</li>
              <li>Images normalized and stored privately</li>
            </ul>
            <strong className="source-action">{signedIn ? "Continue to upload" : "Sign in to continue"} <span aria-hidden="true">â†’</span></strong>
          </div>
        </Link>
      </div>

      <p className="source-help">
        Not sure? Start with the sample. It demonstrates the same six-stage Cut Card workflow
        without using personal images or a billable API request.
      </p>
    </section>
  );
}