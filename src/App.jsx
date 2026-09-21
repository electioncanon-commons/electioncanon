import { Routes, Route } from "react-router-dom";
import { ForgeIdentityProvider } from "./os/ForgeIdentity.jsx";

import Landing from "./pages/Landing.jsx";
import Election from "./pages/Election.jsx";
import Access from "./pages/Access.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

import E03MotionFinal from "./e03/E03MotionFinal.jsx";
import E04WhoDeyHandleAm from "./e04/E04WhoDeyHandleAm.jsx";
import E05Readiness from "./e05/E05Readiness.jsx";
import E06Attention from "./e06/E06Attention.jsx";
import E07ActionCoordination from "./e07/E07ActionCoordination.jsx";
import E08Scale from "./e08/E08Scale.jsx";
import E09Payoff from "./e09/E09Payoff.jsx";

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
        <Route path="/" element={<Landing />} />
        <Route path="/election" element={<Election />} />
        <Route path="/access" element={<Access />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/e03-preview" element={<E03MotionFinal />} />
        <Route path="/e04-preview" element={<E04WhoDeyHandleAm />} />
        <Route path="/e05-preview" element={<E05Readiness />} />
        <Route path="/e06-preview" element={<E06Attention />} />
        <Route path="/e07-preview" element={<E07ActionCoordination />} />
        <Route path="/e08-preview" element={<E08Scale />} />
        <Route path="/e09-preview" element={<E09Payoff />} />

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