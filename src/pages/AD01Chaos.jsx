import React, { useEffect, useState } from "react";
import "./AD01Chaos.css";

const messages = [
  ["Ward Coordination", "Who dey handle PU 007?", "7:41 PM"],
  ["LGA Team", "Abeg send me the ward list.", "7:42 PM"],
  ["Field Team", "Has the material arrived?", "7:42 PM"],
  ["Ward Coordination", "Please confirm.", "7:43 PM"],
  ["Field Team", "sed", "7:44 PM"],
  ["Field Team", "i havent gotten the update", "7:44 PM"],
];

const calls = [
  ["Ward Coordinator", "Missed call", "7:43 PM"],
  ["LGA Team", "Missed call", "7:45 PM"],
  ["Unknown number", "Missed call", "7:46 PM"],
];

function Message({ item, index }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 650 + index * 390);
    return () => clearTimeout(timer);
  }, [index]);
  if (!visible) return null;

  return (
    <div className={`ad01-message ad01-message-${index}`}>
      <div className="ad01-avatar">{item[0].slice(0, 1)}</div>
      <div className="ad01-bubble">
        <div className="ad01-sender">{item[0]}</div>
        <div className="ad01-text">{item[1]}</div>
        <div className="ad01-time">{item[2]}</div>
      </div>
    </div>
  );
}

function MissedCall({ item, index }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1850 + index * 520);
    return () => clearTimeout(timer);
  }, [index]);
  if (!visible) return null;

  return (
    <div className={`ad01-call ad01-call-${index}`}>
      <div className="ad01-call-icon">↙</div>
      <div>
        <strong>{item[0]}</strong>
        <span>{item[1]} · {item[2]}</span>
      </div>
    </div>
  );
}

export default function AD01Chaos() {
  const [stage, setStage] = useState("chaos");

  useEffect(() => {
    const timer = setTimeout(() => setStage("freeze"), 4750);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className={`ad01 ${stage === "freeze" ? "ad01-freeze" : ""}`}>
      <div className="ad01-statusbar">
        <span>7:46</span>
        <div className="ad01-status-icons"><i /><i /><b>82%</b></div>
      </div>

      <section className="ad01-phone">
        <header className="ad01-phone-header">
          <div className="ad01-back">‹</div>
          <div className="ad01-contact">
            <div className="ad01-contact-avatar">W</div>
            <div>
              <strong>Election field team</strong>
              <span>6 messages · 3 calls</span>
            </div>
          </div>
          <div className="ad01-more">•••</div>
        </header>

        <div className="ad01-content">
          <div className="ad01-date">TODAY</div>
          <div className="ad01-messages">
            {messages.map((item, index) => (
              <Message key={index} item={item} index={index} />
            ))}
          </div>
          <div className="ad01-calls">
            {calls.map((item, index) => (
              <MissedCall key={index} item={item} index={index} />
            ))}
          </div>
          <div className="ad01-input">
            <span>Type a message</span><b>➤</b>
          </div>
        </div>
      </section>

      <div className="ad01-chaos-label">
        <span>ELECTION OPERATIONS</span>
        <strong>TOO MUCH NOISE.</strong>
      </div>

      <div className="ad01-freeze-copy">
        <div>CHAOTIC ELECTION OPERATIONS?</div>
        <strong>NO MORE.</strong>
      </div>

      <div className="ad01-bottom-mark">ELECTIONCANON</div>
    </main>
  );
}
