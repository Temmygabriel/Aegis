"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/app/providers";
import { shortAddr } from "@/lib/format";
import { addressFromPk, isValidPk } from "@/lib/identity";

export function IdentityBadge() {
  const { identity, ready, reset, importKey } = useIdentity();

  const [open, setOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const [mmAddress, setMmAddress] = useState<string | null>(null);
  const [mmError, setMmError] = useState<string | null>(null);

  // -- import-from-key form state
  const [importOpen, setImportOpen] = useState(false);
  const [importPk, setImportPk] = useState("");
  const [recovers, setRecovers] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // -- "generate new identity" inline confirmation (type DELETE)
  const [delConfirm, setDelConfirm] = useState(false);
  const [delTyped, setDelTyped] = useState("");

  const menuRef = useRef<HTMLDivElement>(null);

  // Reset all ephemeral state every time the menu closes.
  useEffect(() => {
    if (!open) {
      setShowKey(false);
      setCopiedAddr(false);
      setCopiedKey(false);
      setMmError(null);
      setImportOpen(false);
      setImportPk("");
      setRecovers(null);
      setImportErr(null);
      setImportMsg(null);
      setDelConfirm(false);
      setDelTyped("");
    }
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function copyText(text: string, setter: (v: boolean) => void) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setter(true);
        setTimeout(() => setter(false), 1800);
      })
      .catch(() => {
        /* clipboard denied — nothing else sensible to do */
      });
  }

  function onImportChange(v: string) {
    setImportPk(v);
    setImportErr(null);
    setImportMsg(null);
    const trimmed = v.trim();
    if (!trimmed) {
      setRecovers(null);
      return;
    }
    if (isValidPk(trimmed)) {
      setRecovers(addressFromPk(trimmed));
    } else {
      setRecovers(null);
      setImportErr("Not a valid private key — needs 0x followed by 64 hex characters.");
    }
  }

  function doImport() {
    const pk = importPk.trim();
    if (!isValidPk(pk)) {
      setImportErr("Not a valid private key — needs 0x followed by 64 hex characters.");
      return;
    }
    if (identity && pk.toLowerCase() === identity.privateKey.toLowerCase()) {
      setImportMsg("That's already the active identity — nothing changed.");
      return;
    }
    try {
      importKey(pk);
      setOpen(false);
    } catch (e: any) {
      setImportErr(e?.message ?? String(e));
    }
  }

  async function connectMetaMask() {
    setMmError(null);
    const eth = (window as {
      ethereum?: { request: (a: { method: string }) => Promise<string[]> };
    }).ethereum;
    if (!eth) {
      setMmError("MetaMask isn't installed. Add the extension and try again.");
      return;
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      setMmAddress(accounts[0] ?? null);
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 4001) {
        setMmError("Connection cancelled.");
      } else {
        setMmError("MetaMask connection failed.");
      }
    }
  }

  if (!ready || !identity) {
    return (
      <span className="idchip">
        <span className="seal" />
        <span className="mono muted">identity…</span>
      </span>
    );
  }

  const displayAddress = mmAddress ?? identity.address;
  const displayLabel = mmAddress ? "MetaMask (display only)" : "Browser identity";

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      {/* ------------------------------- chip trigger ----------------------- */}
      <button
        className={`idchip ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Open identity menu"
      >
        <span className="seal" />
        <span className="idchip-addr mono">{shortAddr(identity.address)}</span>
        <span className="idcaret">{open ? "▲" : "▼"}</span>
      </button>

      {/* ------------------------------- dropdown --------------------------- */}
      {open && (
        <div className="idmenu">
          {/* 1 — address */}
          <div className="idsec">
            <div className="idlabel">{displayLabel}</div>
            <div className="idwell-row">
              <span className="idwell mono">{displayAddress}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => copyText(displayAddress, setCopiedAddr)}
              >
                {copiedAddr ? "Copied" : "Copy"}
              </button>
            </div>
            {mmAddress && (
              <div className="idhint mono">
                Signer (actual): {shortAddr(identity.address)}
              </div>
            )}
          </div>

          <hr className="idsep" />

          {/* 2 — honesty notice */}
          <div className="idnote">
            Every transaction is signed by your browser-stored identity, not
            MetaMask. MetaMask can&apos;t sign for this chain — if you connect it
            below it&apos;s shown for reference only.
          </div>

          <hr className="idsep" />

          {/* 3 — private key */}
          <div className="idsec">
            <div className="idlabel">Private key</div>
            {!showKey ? (
              <button
                className="btn btn-ghost btn-sm idwide"
                onClick={() => setShowKey(true)}
              >
                Show private key
              </button>
            ) : (
              <div className="idstack">
                <div className="idwell mono idkey" style={{ userSelect: "all" }}>
                  {identity.privateKey}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyText(identity.privateKey, setCopiedKey)}
                >
                  {copiedKey ? "Copied" : "Copy private key"}
                </button>
                <div className="idhint">
                  Stored only in this browser. Clearing site data or switching
                  devices loses it permanently — save it somewhere safe if it holds
                  funds.
                </div>
              </div>
            )}
          </div>

          <hr className="idsep" />

          {/* 4 — recover wallet */}
          <div className="idsec">
            <div className="idlabel">Recover wallet</div>
            {!importOpen ? (
              <button
                className="btn btn-ghost btn-sm idwide"
                onClick={() => setImportOpen(true)}
              >
                Import from private key
              </button>
            ) : (
              <div className="idstack">
                <input
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0x… your private key"
                  value={importPk}
                  onChange={(e) => onImportChange(e.target.value)}
                />
                {importErr && <div className="iderr mono">{importErr}</div>}
                {!importErr && recovers && (
                  <div className="idok mono">
                    Recovers: <b>{recovers}</b>
                  </div>
                )}
                {importMsg && <div className="idok mono">{importMsg}</div>}
                <div className="btn-row">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!isValidPk(importPk.trim())}
                    onClick={doImport}
                  >
                    Recover
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setImportOpen(false);
                      setImportPk("");
                      setRecovers(null);
                      setImportErr(null);
                      setImportMsg(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div className="idhint">
                  Importing swaps the whole signer — this browser will act as that
                  address from now on.
                </div>
              </div>
            )}
          </div>

          <hr className="idsep" />

          {/* 5 — MetaMask (display only) */}
          <div className="idsec mm">
            <div className="idlabel">MetaMask</div>
            {!mmAddress ? (
              <div className="idstack">
                <button className="btn btn-ghost btn-sm idwide" onClick={connectMetaMask}>
                  Connect MetaMask (display only)
                </button>
                {mmError && <div className="iderr mono">{mmError}</div>}
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm idwide"
                onClick={() => setMmAddress(null)}
              >
                Hide MetaMask address
              </button>
            )}
            <div className="idhint">
              MetaMask can&apos;t sign GenLayer transactions. This is here just to
              show you why.
            </div>
          </div>

          <hr className="idsep" />

          {/* 6 — danger */}
          <div className="idsec danger">
            <div className="idlabel">Danger zone</div>
            {!delConfirm ? (
              <button
                className="btn btn-danger btn-sm idwide"
                onClick={() => setDelConfirm(true)}
              >
                Generate new identity
              </button>
            ) : (
              <div className="idstack">
                <div className="idhint">
                  Generating a new identity swaps the browser signer. Your current
                  address stays on-chain, but this browser will act as a different
                  address from now on — any agent registration or funded LP
                  position tied to the current one becomes unreachable from here.
                </div>
                <input
                  className="input mono"
                  placeholder="Type DELETE to confirm"
                  autoComplete="off"
                  spellCheck={false}
                  value={delTyped}
                  onChange={(e) => setDelTyped(e.target.value)}
                />
                <div className="btn-row">
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={delTyped.trim().toUpperCase() !== "DELETE"}
                    onClick={() => {
                      reset();
                      setOpen(false);
                    }}
                  >
                    Generate new identity
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDelConfirm(false);
                      setDelTyped("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
