import React, { useState, useEffect } from "react";

export default function FlowchartShowcase({ onLaunchWorkspace }) {
  const [selectedStep, setSelectedStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Auto-shift step circularly every 1.7s (reduced by 0.3s from 2s)
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setSelectedStep((prev) => (prev + 1) % 4);
    }, 1700);
    return () => clearInterval(interval);
  }, [isPaused]);

  const pipelineSteps = [
    {
      id: "ingestion",
      title: "Ingestion",
      icon: "description",
      description:
        "Upload and extract text, scanned pages, and tables from multi-page documents.",
      detail:
        "Accepts multi-page documents and processes pages into clear, searchable passages while preserving original page references."
    },
    {
      id: "embeddings",
      title: "Embeddings",
      icon: "scatter_plot",
      description:
        "Convert extracted passages into dense semantic vectors and index them in the vector database.",
      detail:
        "Passages are encoded into dense representations that capture conceptual meaning and context, enabling fast similarity search."
    },
    {
      id: "retrieval",
      title: "Retrieval",
      icon: "manage_search",
      description:
        "Search across document passages using both semantic matching and keyword search.",
      detail:
        "Evaluates both semantic concepts and exact keyword terms to retrieve the most relevant passages for your query."
    },
    {
      id: "verification",
      title: "Verification",
      icon: "verified_user",
      description:
        "Synthesize direct answers grounded in retrieved passages with verified page citations.",
      detail:
        "Answers are generated directly from the retrieved document text, linking each statement to exact page references for easy verification."
    }
  ];

  const capabilities = [
    {
      title: "EXACT SOURCE CITATIONS",
      badgeColor: "#059669",
      bgColor: "#ecfdf5",
      borderColor: "#a7f3d0",
      icon: "fact_check",
      description:
        "Every answer is tracked directly to document pages with verified references and clickable page badges."
    },
    {
      title: "VISION & OCR",
      badgeColor: "#374151",
      bgColor: "#f4f3ed",
      borderColor: "#dcd9cf",
      icon: "document_scanner",
      description:
        "Extract text, mathematical formulas, and tables from scanned documents and high-resolution academic pages."
    },
    {
      title: "HYBRID RETRIEVAL",
      badgeColor: "#d97706",
      bgColor: "#fffbeb",
      borderColor: "#fde68a",
      icon: "alt_route",
      description:
        "Combine semantic vector embeddings with keyword matching to find all relevant passages."
    },
    {
      title: "FACT VERIFICATION AGENT",
      badgeColor: "#e11d48",
      bgColor: "#fff1f2",
      borderColor: "#fecdd3",
      icon: "verified",
      description:
        "Context verification cross-references answers against retrieved passages before responding."
    }
  ];

  const comparisons = [
    {
      feature: "Fact Verification",
      standard: "✕ Unverified assertions without source grounding",
      helpme: "✓ Grounded verification with direct source references"
    },
    {
      feature: "Scanned Documents & Tables",
      standard: "✕ Fails on images & complex tables",
      helpme: "✓ Text extraction with Vision OCR support"
    },
    {
      feature: "Search Precision",
      standard: "✕ Keyword-blind vector search",
      helpme: "✓ Hybrid search combining semantic meaning & keywords"
    },
    {
      feature: "Page Proof & Traceability",
      standard: "✕ Generic unverified summaries",
      helpme: "✓ Clickable exact page badges [Pg X]"
    },
    {
      feature: "Large Document Handling",
      standard: "✕ Context window overflow",
      helpme: "✓ Streaming ingestion & segmented passage indexing"
    }
  ];

  return (
    <div className="editorial-showcase-wrap">
      {/* 1. Pipeline Linear Flow Section */}
      <section id="pipeline" className="pipeline-stream-section scroll-reveal">
        <div className="editorial-container">
          <div
            className="pipeline-stream-bar"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            {pipelineSteps.map((step, idx) => (
              <React.Fragment key={step.id}>
                <div
                  className={`pipeline-stream-step ${selectedStep === idx ? "active" : ""}`}
                  onClick={() => setSelectedStep(idx)}
                  onMouseEnter={() => setSelectedStep(idx)}
                  role="button"
                  tabIndex={0}
                >
                  <div className={`step-icon-box ${selectedStep === idx ? "active-icon-box" : "neutral-box"}`}>
                    <span className="material-symbols-outlined">{step.icon}</span>
                  </div>
                  <div className="step-info">
                    <strong className="step-title">{step.title}</strong>
                    <p className="step-desc">{step.description}</p>
                  </div>
                </div>
                {idx < pipelineSteps.length - 1 && (
                  <div className="pipeline-arrow-separator">
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Interactive Inspection of Selected Step: Smooth animation and detailed description */}
          <div className="selected-step-detail-card clean-detail" key={selectedStep}>
            <div className="detail-card-header clean-header">
              <span className="detail-stage-title">
                STAGE 0{selectedStep + 1} : {pipelineSteps[selectedStep].title.toUpperCase()}
              </span>
            </div>
            <p className="detail-text large-readable">{pipelineSteps[selectedStep].detail}</p>
            <div className="detail-action-row">
              <button
                type="button"
                className="detail-cta-btn"
                onClick={onLaunchWorkspace}
              >
                Try {pipelineSteps[selectedStep].title} in workspace →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Core Capabilities Section */}
      <section id="capabilities" className="capabilities-section scroll-reveal">
        <div className="editorial-container">
          <h2 className="editorial-section-title">CORE CAPABILITIES</h2>

          <div className="capabilities-grid">
            {capabilities.map((cap, i) => (
              <div key={i} className="capability-card">
                <div className="capability-header">
                  <div
                    className="capability-icon-badge"
                    style={{
                      backgroundColor: cap.bgColor,
                      color: cap.badgeColor,
                      borderColor: cap.borderColor
                    }}
                  >
                    <span className="material-symbols-outlined">{cap.icon}</span>
                  </div>
                  <h3 className="capability-title">{cap.title}</h3>
                </div>
                <p className="capability-desc">{cap.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Comparison Table (Standard LLMs vs HelpMe AI) */}
      <section id="benchmarks" className="comparison-section scroll-reveal">
        <div className="editorial-container">
          <div className="comparison-card">
            <h3 className="comparison-heading">STANDARD LLMS VS. HELPME AI</h3>

            <div className="comparison-table-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th className="th-feature">FEATURE</th>
                    <th className="th-standard">STANDARD LLMS</th>
                    <th className="th-helpme">HELPME AI</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((row, index) => (
                    <tr key={index}>
                      <td className="td-feature">{row.feature}</td>
                      <td className="td-standard">{row.standard}</td>
                      <td className="td-helpme">{row.helpme}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
