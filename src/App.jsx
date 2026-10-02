import { Routes, Route } from "react-router-dom";
import { ForgeIdentityProvider } from "./os/ForgeIdentity.jsx";
// VISIBILITY EXPANSION PASS — same LanguageProvider Election.jsx's own
// shell() already mounts for the authenticated app, reused here around the
// public Landing route only (Landing.jsx had no language selection at all
// before this pass). Not a second provider/context: one LanguageProvider
// implementation, mounted at two independent root points, each scoped to
// the page tree that actually needs it. Both read/write the SAME
// localStorage key (LanguageContext.jsx's own STORAGE_KEY), so a language
// chosen here is still selected after a visitor signs in.
import { LanguageProvider } from "./pages/election/LanguageContext.jsx";

import Landing from "./pages/Landing.jsx";
import Election from "./pages/Election.jsx";
import Access from "./pages/Access.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

import AD01Chaos from "./pages/AD01Chaos.jsx";

import Launch from "./pages/launch/Launch.jsx";
import LaunchAd01 from "./pages/launch/LaunchAd01.jsx";
import LaunchAd02 from "./pages/launch/LaunchAd02.jsx";
import LaunchAd03 from "./pages/launch/LaunchAd03.jsx";
import LaunchConfirm from "./pages/launch/LaunchConfirm.jsx";
import LaunchUnsubscribe from "./pages/launch/LaunchUnsubscribe.jsx";

export default function App() {
  return (
    <ForgeIdentityProvider>
      <Routes>
        <Route path="/" element={<LanguageProvider><Landing /></LanguageProvider>} />
        <Route path="/election" element={<Election />} />
        <Route path="/access" element={<Access />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/ad01-preview" element={<AD01Chaos />} />

        <Route path="/launch" element={<Launch />} />
        <Route path="/launch/ad01" element={<LaunchAd01 />} />
        <Route path="/launch/ad02" element={<LaunchAd02 />} />
        <Route path="/launch/ad03" element={<LaunchAd03 />} />
        <Route path="/launch/confirm" element={<LaunchConfirm />} />
        <Route path="/launch/unsubscribe" element={<LaunchUnsubscribe />} />
      </Routes>
    </ForgeIdentityProvider>
  );
}