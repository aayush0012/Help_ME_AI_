import React from "react";

export default function Navbar({
  showLanding,
  setShowLanding,
  activeDocument,
  onOpenWorkspace
}) {
  const scrollToSection = (e, sectionId) => {
    e.preventDefault();
    if (!showLanding) {
      setShowLanding(true);
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } else {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header className="site-navbar">
      <div className="navbar-container">
        {/* Brand Wordmark (matching reference design) */}
        <div
          className="navbar-brand"
          onClick={() => setShowLanding(true)}
          role="button"
          tabIndex={0}
        >
          <span className="brand-wordmark">HELPME AI</span>
        </div>

        {/* Center Links (matching reference: Pipeline, Capabilities, Benchmarks, Why Us) */}
        <nav className="navbar-links" aria-label="Main Navigation">
          <a
            href="#pipeline"
            className="nav-link"
            onClick={(e) => scrollToSection(e, "pipeline")}
          >
            Pipeline
          </a>
          <a
            href="#capabilities"
            className="nav-link"
            onClick={(e) => scrollToSection(e, "capabilities")}
          >
            Capabilities
          </a>
          <a
            href="#benchmarks"
            className="nav-link"
            onClick={(e) => scrollToSection(e, "benchmarks")}
          >
            Benchmarks
          </a>
          <a
            href="#why-us"
            className="nav-link"
            onClick={(e) => scrollToSection(e, "why-us")}
          >
            Why Us
          </a>
        </nav>

        {/* Right Action: Main Workspace Option At The Top */}
        <div className="navbar-actions">
          {activeDocument && (
            <div className="nav-doc-indicator">
              <span className="nav-doc-name">{activeDocument}</span>
            </div>
          )}

          {!showLanding ? (
            <button
              type="button"
              className="nav-btn-secondary"
              onClick={() => setShowLanding(true)}
            >
              Overview
            </button>
          ) : (
            <button
              type="button"
              className="nav-btn-primary"
              onClick={() => (onOpenWorkspace ? onOpenWorkspace() : setShowLanding(false))}
            >
              Open Workspace
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
