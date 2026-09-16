import { useState, useEffect, useRef } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Navbar from "./components/Navbar";
import FlowchartShowcase from "./components/FlowchartShowcase";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "https://help-me-zdr2.onrender.com");

const getSessionId = () => {
  let sessionId = sessionStorage.getItem("helpme_session_id");
  if (!sessionId) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
    } else {
      sessionId =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
    }
    sessionStorage.setItem("helpme_session_id", sessionId);
  }
  return sessionId;
};

function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [activeDocument, setActiveDocument] = useState(null);
  const [chunksIndexed, setChunksIndexed] = useState(null);
  const [message, setMessage] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Auto-slide circular loop across all 4 slides (Dashboard + 3 process steps)
  useEffect(() => {
    if (!showLanding) return;
    const interval = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % 4);
    }, 1400);
    return () => clearInterval(interval);
  }, [showLanding]);

  // Continuous appearing transition on scrolling both up and down repeatedly
  useEffect(() => {
    if (!showLanding) return;

    const checkVisibility = () => {
      const windowHeight = window.innerHeight;
      const revealElements = document.querySelectorAll(".scroll-reveal");

      revealElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Visible when within active viewport range (both scrolling down and up)
        const inView = rect.top < windowHeight - 70 && rect.bottom > 70;
        if (inView) {
          el.classList.add("is-visible");
        } else {
          el.classList.remove("is-visible");
        }
      });
    };

    // Initial check
    checkVisibility();

    window.addEventListener("scroll", checkVisibility, { passive: true });
    window.addEventListener("resize", checkVisibility, { passive: true });

    return () => {
      window.removeEventListener("scroll", checkVisibility);
      window.removeEventListener("resize", checkVisibility);
    };
  }, [showLanding]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (!showLanding) {
      scrollToBottom();
    }
  }, [messages, thinking, showLanding]);

  const uploadDocument = async (fileToUpload, { openWorkspace = true } = {}) => {
    if (!fileToUpload) return;
    setUploading(true);
    setSelectedFileName(fileToUpload.name);
    setMessage("Extracting passages and indexing hybrid embeddings…");

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const sessionId = getSessionId();
      const response = await axios.post(
        `${API_BASE}/upload?session_id=${sessionId}`,
        formData
      );
      setActiveDocument(fileToUpload.name);
      setChunksIndexed(response.data.chunks_indexed ?? null);
      setMessages([]);
      setMessage(`${fileToUpload.name} is ready for queries.`);
      if (openWorkspace) {
        setShowLanding(false);
      }
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail;
      setMessage(detail ? `Upload failed: ${detail}` : "Upload failed. Please check backend connection.");
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const question = input;

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        sender: "user",
        text: question,
      },
    ]);

    setInput("");
    setThinking(true);

    try {
      const sessionId = getSessionId();
      const response = await axios.post(
        `${API_BASE}/chat?question=${encodeURIComponent(question)}&session_id=${sessionId}`
      );
      setThinking(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: "bot",
          text: response.data.answer,
          sources: response.data.sources || [],
        },
      ]);
    } catch (err) {
      console.error(err);
      setThinking(false);
      const detail = err.response?.data?.detail;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: "bot",
          text: detail || "Unable to connect to server. Please ingest a document first.",
          sources: [],
        },
      ]);
    }
  };

  const handleQuickPrompt = (promptText) => {
    if (!activeDocument) {
      setMessage("Please upload a PDF document before querying.");
      setShowLanding(false);
      return;
    }
    setShowLanding(false);
    setInput(promptText);
    setTimeout(async () => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: "user",
          text: promptText,
        },
      ]);
      setInput("");
      setThinking(true);
      try {
        const sessionId = getSessionId();
        const response = await axios.post(
          `${API_BASE}/chat?question=${encodeURIComponent(promptText)}&session_id=${sessionId}`
        );
        setThinking(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            sender: "bot",
            text: response.data.answer,
            sources: response.data.sources || [],
          },
        ]);
      } catch (err) {
        console.error(err);
        setThinking(false);
        const detail = err.response?.data?.detail;
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            sender: "bot",
            text: detail || "Unable to connect to server.",
            sources: [],
          },
        ]);
      }
    }, 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!thinking) {
        handleSend();
      }
    }
  };

  const handleCopyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className="site-root"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
          uploadDocument(file, { openWorkspace: true });
        }
      }}
    >
      {/* Top Navbar */}
      <Navbar
        showLanding={showLanding}
        setShowLanding={setShowLanding}
        activeDocument={activeDocument}
        onOpenWorkspace={() => setShowLanding(false)}
      />

      {showLanding ? (
        <div className="landing-layout animate-fade-in">
          {/* Hero Section */}
          <section className="editorial-hero-section">
            <div className="editorial-hero-container">
              {/* Left Column: Headline with Italics, Subtitle, Action Card (Sample Questions Removed) */}
              <div className="hero-left-col">
                <h1 className="hero-editorial-headline">
                  <em>THE INTELLIGENT AI RETRIEVAL PIPELINE</em>
                </h1>
                <p className="hero-editorial-subtitle">
                  Zero Hallucinations. Exact Source Citations. Fact Verification.
                </p>

                {/* Main Workspace Action / Ingestion Bar at the Top */}
                <div className="hero-input-action-card">
                  <div className="hero-input-row">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="application/pdf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadDocument(file, { openWorkspace: true });
                      }}
                    />
                    <div
                      className="hero-pseudo-input"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="material-symbols-outlined input-icon">attach_file</span>
                      <span className="pseudo-placeholder">
                        {uploading
                          ? "Uploading and indexing document..."
                          : selectedFileName
                          ? selectedFileName
                          : "Select or drop any PDF document to begin..."}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="hero-submit-btn"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.click();
                        } else {
                          setShowLanding(false);
                        }
                      }}
                    >
                      <span>{uploading ? "Indexing..." : "Start for free"}</span>
                    </button>
                  </div>

                  {uploading && (
                    <div className="hero-upload-status">
                      <span className="status-spinner"></span>
                      <span>Processing multi-page document with PyMuPDF &amp; Vision OCR...</span>
                    </div>
                  )}

                  {message && !uploading && (
                    <div className={`hero-upload-status ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : "ready"}`}>
                      <span className="material-symbols-outlined">
                        {message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : "check_circle"}
                      </span>
                      <span>{message}</span>
                    </div>
                  )}
                </div>

                <p className="hero-editorial-caption">
                  <span className="stop-guessing-cursive">Stop guessing.</span> Use the HelpMe AI hybrid search to find precise answers with direct citations, even from scanned PDFs.
                </p>
              </div>

              {/* Right Column: Perspective Dashboard Graphic */}
              <div className="hero-right-col">
                <div className="hero-perspective-wrap">
                  <div className="mock-dashboard-card">
                    {/* Dashboard Top Header - Badge Completely Removed */}
                    <div className="dashboard-card-topbar">
                      <div className="dash-window-dots">
                        <span className="dot d1"></span>
                        <span className="dot d2"></span>
                        <span className="dot d3"></span>
                      </div>
                      <div className="dash-tabs">
                        <button
                          type="button"
                          className={`dash-tab ${slideIndex === 0 ? "active" : ""}`}
                          onClick={() => setSlideIndex(0)}
                        >
                          Dashboard
                        </button>
                        <button
                          type="button"
                          className={`dash-tab ${slideIndex === 1 ? "active" : ""}`}
                          onClick={() => setSlideIndex(1)}
                        >
                          01 Upload
                        </button>
                        <button
                          type="button"
                          className={`dash-tab ${slideIndex === 2 ? "active" : ""}`}
                          onClick={() => setSlideIndex(2)}
                        >
                          02 Ask Query
                        </button>
                        <button
                          type="button"
                          className={`dash-tab ${slideIndex === 3 ? "active" : ""}`}
                          onClick={() => setSlideIndex(3)}
                        >
                          03 Answer
                        </button>
                      </div>
                    </div>

                    {/* Auto-Slide Carousel Content Area */}
                    <div className="dash-slides-container">
                      {slideIndex === 0 && (
                        <div className="dash-slide animate-fade-in" key="slide-0">
                          {/* Minimal Line Chart Mockup */}
                          <div className="dashboard-chart-strip">
                            <div className="chart-header">
                              <span className="chart-title">Retrieval &amp; Relevance Ranking</span>
                              <span className="chart-stat">Active</span>
                            </div>
                            <div className="mock-line-chart">
                              <div className="chart-bars">
                                <span style={{ height: "35%" }}></span>
                                <span style={{ height: "60%" }}></span>
                                <span style={{ height: "45%" }}></span>
                                <span style={{ height: "75%" }}></span>
                                <span style={{ height: "90%" }}></span>
                                <span style={{ height: "65%" }}></span>
                                <span style={{ height: "80%" }}></span>
                                <span style={{ height: "88%" }}></span>
                              </div>
                            </div>
                          </div>

                          {/* Embedded Flowchart */}
                          <div className="dashboard-flowchart-box">
                            <div className="df-title">RETRIEVAL PIPELINE FLOW</div>
                            <div className="df-flow-row">
                              <div className="df-node">
                                <span className="material-symbols-outlined df-icon">description</span>
                                <span className="df-label">Ingestion</span>
                                <span className="df-sub">PyMuPDF / OCR</span>
                              </div>
                              <span className="df-arrow">→</span>
                              <div className="df-node">
                                <span className="material-symbols-outlined df-icon">hub</span>
                                <span className="df-label">Embeddings</span>
                                <span className="df-sub">ChromaDB</span>
                              </div>
                              <span className="df-arrow">→</span>
                              <div className="df-node">
                                <span className="material-symbols-outlined df-icon">manage_search</span>
                                <span className="df-label">Retrieval</span>
                                <span className="df-sub">Dense + BM25</span>
                              </div>
                              <span className="df-arrow">→</span>
                              <div className="df-node">
                                <span className="material-symbols-outlined df-icon">verified_user</span>
                                <span className="df-label">Verification</span>
                                <span className="df-sub">Exact Citations</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {slideIndex === 1 && (
                        <div className="dash-slide animate-fade-in" key="slide-1">
                          <div className="slide-header-strip">
                            <span className="slide-step-tag">STEP 01</span>
                            <strong className="slide-main-title">Upload Study Document</strong>
                          </div>
                          <div className="slide-card-visual">
                            <div className="slide-doc-box">
                              <span className="material-symbols-outlined slide-file-icon">description</span>
                              <div className="slide-doc-details">
                                <strong>Textbook_Chapter_04.pdf</strong>
                                <span>34 Pages • Text, formulas, and diagrams extracted</span>
                              </div>
                            </div>
                            <div className="slide-passages-list">
                              <div className="slide-passage-pill">Passage #01 [Pg 1] • Overview</div>
                              <div className="slide-passage-pill">Passage #02 [Pg 2] • Core Concepts</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {slideIndex === 2 && (
                        <div className="dash-slide animate-fade-in" key="slide-2">
                          <div className="slide-header-strip">
                            <span className="slide-step-tag">STEP 02</span>
                            <strong className="slide-main-title">Ask Any Question</strong>
                          </div>
                          <div className="slide-card-visual">
                            <div className="slide-query-box">
                              <span className="material-symbols-outlined slide-query-icon">help_outline</span>
                              <div className="slide-query-details">
                                <span className="slide-query-label">STUDENT QUESTION</span>
                                <p className="slide-query-text">
                                  "What are the main stages of cellular respiration and where do they occur?"
                                </p>
                              </div>
                            </div>
                            <div className="slide-search-dual">
                              <span className="slide-engine-pill">Semantic Vectors</span>
                              <span className="slide-engine-pill">Keyword Search</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {slideIndex === 3 && (
                        <div className="dash-slide animate-fade-in" key="slide-3">
                          <div className="slide-header-strip">
                            <span className="slide-step-tag">STEP 03</span>
                            <strong className="slide-main-title">Get Grounded Answers</strong>
                          </div>
                          <div className="slide-card-visual">
                            <div className="slide-answer-box">
                              <div className="slide-answer-top">
                                <span className="material-symbols-outlined answer-check">check_circle</span>
                                <span>VERIFIED ANSWER</span>
                              </div>
                              <p className="slide-answer-text">
                                1. <strong>Glycolysis</strong> in the cytoplasm, 2. <strong>Krebs Cycle</strong> in mitochondrial matrix, and 3. <strong>Electron Transport Chain</strong> on inner membrane.
                              </p>
                              <div className="slide-citations-row">
                                <span className="slide-citation-tag">📄 Textbook_Chapter_04.pdf [Pg 14]</span>
                                <span className="slide-citation-tag">📄 Textbook_Chapter_04.pdf [Pg 18]</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Circular Loop Carousel Controls */}
                  <div className="dashboard-carousel-controls">
                    <button
                      type="button"
                      className="carousel-arrow-btn"
                      onClick={() => setSlideIndex((prev) => (prev - 1 + 4) % 4)}
                      aria-label="Previous slide"
                    >
                      ‹
                    </button>
                    {[0, 1, 2, 3].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`carousel-dot-btn ${slideIndex === idx ? "active" : ""}`}
                        onClick={() => setSlideIndex(idx)}
                        aria-label={`Go to slide ${idx + 1}`}
                      />
                    ))}
                    <button
                      type="button"
                      className="carousel-arrow-btn"
                      onClick={() => setSlideIndex((prev) => (prev + 1) % 4)}
                      aria-label="Next slide"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Linear Pipeline (Ingestion, Embeddings, Retrieval, Verification), Capabilities & Benchmarks */}
          <FlowchartShowcase onLaunchWorkspace={() => setShowLanding(false)} />

          {/* Why Us Section */}
          <section id="why-us" className="editorial-whyus-section scroll-reveal">
            <div className="editorial-container">
              <div className="whyus-card">
                <div className="whyus-text">
                  <h3 className="whyus-title">Built for Accurate Study &amp; Research</h3>
                  <p className="whyus-desc">
                    Get accurate, verified answers and exact page citations directly from your textbooks, lecture slides, and study notes with zero hallucinations.
                  </p>
                </div>
                <button
                  type="button"
                  className="whyus-btn"
                  onClick={() => setShowLanding(false)}
                >
                  Launch Workspace Now →
                </button>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="editorial-footer">
            <div className="editorial-container footer-flex">
              <span className="footer-brand">HELPME AI</span>
              <nav className="footer-nav">
                <a href="#pipeline">Pipeline</a>
                <a href="#capabilities">Capabilities</a>
                <a href="#benchmarks">Benchmarks</a>
                <a href="#why-us">Why Us</a>
              </nav>
            </div>
          </footer>
        </div>
      ) : (
        /* Soothing, Clean Chat Workspace View */
        <div className="editorial-workspace-layout animate-fade-in">
          {/* Workspace Left Sidebar */}
          <aside className="workspace-clean-sidebar">
            <div className="clean-sidebar-top">
              <button
                type="button"
                className="clean-new-chat-btn"
                onClick={() => setMessages([])}
                disabled={messages.length === 0}
              >
                <span className="material-symbols-outlined">add</span>
                <span>New Session</span>
              </button>

              <div className="clean-sidebar-section">
                <span className="sidebar-heading">STUDY MATERIAL</span>
                {activeDocument ? (
                  <div className="sidebar-doc-item">
                    <span className="material-symbols-outlined doc-icon">description</span>
                    <div className="doc-meta">
                      <strong title={activeDocument}>{activeDocument}</strong>
                      <span>{chunksIndexed ? `${chunksIndexed} passages indexed` : "Ready"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="sidebar-doc-empty">
                    <span>No document selected</span>
                    <button
                      type="button"
                      className="sidebar-upload-trigger"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose PDF
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="clean-sidebar-bottom">
              <button
                type="button"
                className="sidebar-overview-btn"
                onClick={() => setShowLanding(true)}
              >
                <span className="material-symbols-outlined">arrow_back</span>
                <span>Back to Overview</span>
              </button>
            </div>
          </aside>

          {/* Main Chat Content Area */}
          <main className="workspace-clean-main">
            <header className="clean-workspace-header">
              <div className="clean-header-breadcrumb">
                <span className="crumb-light">Workspace</span>
                <span className="crumb-slash">/</span>
                <span className="crumb-dark">{activeDocument || "Study Notes"}</span>
              </div>
            </header>

            {uploading && (
              <div className="workspace-upload-status">
                <span className="status-spinner"></span>
                <span>Processing multi-page document with PyMuPDF &amp; Vision OCR...</span>
              </div>
            )}

            {message && !uploading && (
              <div className={`workspace-upload-status ${message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : "ready"}`}>
                <span className="material-symbols-outlined">
                  {message.toLowerCase().includes("fail") || message.toLowerCase().includes("error") ? "error" : "check_circle"}
                </span>
                <span>{message}</span>
              </div>
            )}

            {/* Chat Messages */}
            <div className="clean-chat-scroll">
              {messages.length === 0 && !thinking && (
                <div className="clean-empty-hero">
                  <h2>
                    {activeDocument
                      ? `Ready to study ${activeDocument}`
                      : "Upload your study material"}
                  </h2>
                  <p>
                    {activeDocument
                      ? "Ask questions, generate practice questions, or get key concepts explained with exact page references."
                      : "Upload your textbook chapter, lecture slides, or reading material to start studying."}
                  </p>

                  {!activeDocument && (
                    <label className="clean-upload-btn">
                      <input
                        type="file"
                        accept="application/pdf"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadDocument(file, { openWorkspace: false });
                        }}
                      />
                      <span className="material-symbols-outlined">upload_file</span>
                      <span>Select PDF Document</span>
                    </label>
                  )}

                  <div className="clean-sample-chips">
                    <button
                      type="button"
                      className="clean-chip"
                      onClick={() => handleQuickPrompt("Summarize this document into clear exam revision notes with key points.")}
                    >
                      📝 Summarize into Exam Notes
                    </button>
                    <button
                      type="button"
                      className="clean-chip"
                      onClick={() => handleQuickPrompt("Generate 5 practice quiz questions based on this document with answers.")}
                    >
                      ❓ Create Practice Quiz (5 Questions)
                    </button>
                    <button
                      type="button"
                      className="clean-chip"
                      onClick={() => handleQuickPrompt("Explain the most important and difficult concept here in simple words.")}
                    >
                      💡 Explain Concept in Simple Words
                    </button>
                    <button
                      type="button"
                      className="clean-chip"
                      onClick={() => handleQuickPrompt("List all important definitions, formulas, and key terms with page references.")}
                    >
                      📌 Key Definitions &amp; Formulas
                    </button>
                    <button
                      type="button"
                      className="clean-chip"
                      onClick={() => handleQuickPrompt("What are the most likely exam questions that can be asked from this chapter?")}
                    >
                      🎯 Probable Exam Questions
                    </button>
                  </div>
                </div>
              )}

              {/* Messages Flow */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`clean-message-row ${msg.sender === "user" ? "user" : "bot"}`}
                >
                  {msg.sender === "user" ? (
                    <div className="clean-user-bubble">
                      <div className="bubble-tag">YOU</div>
                      <div className="bubble-text">{msg.text}</div>
                    </div>
                  ) : (
                    <div className="clean-bot-card">
                      <div className="bot-card-top">
                        <span className="bot-tag">HELPME AI • VERIFIED ANSWER</span>
                      </div>
                      <div className="bot-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text ? msg.text.replace(/\[Source\s+\d+(?:,\s*Source\s+\d+)*\]/gi, "") : ""}
                        </ReactMarkdown>
                      </div>

                      {/* Source Citations */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="clean-citations-box">
                          <span className="citations-title">VERIFIED CITATIONS:</span>
                          <div className="citations-list">
                            {msg.sources.map((src, idx) => (
                              <span key={idx} className="clean-citation-pill">
                                📄 {src.source || "Document"} [Pg {src.pages}]
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="bot-card-actions">
                        <button
                          type="button"
                          className="clean-copy-btn"
                          onClick={() => handleCopyText(msg.text, msg.id)}
                        >
                          <span className="material-symbols-outlined">
                            {copiedId === msg.id ? "check" : "content_copy"}
                          </span>
                          <span>{copiedId === msg.id ? "Copied" : "Copy Answer"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking */}
              {thinking && (
                <div className="clean-message-row bot">
                  <div className="clean-thinking-box">
                    <span className="thinking-spinner"></span>
                    <span>Retrieving hybrid passages &amp; verifying facts...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef}></div>
            </div>

            {/* Bottom Input Dock */}
            <div className="clean-input-dock">
              <div className="clean-input-container">
                <label className="clean-attach-icon" title="Upload new document">
                  <input
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadDocument(file, { openWorkspace: false });
                    }}
                  />
                  <span className="material-symbols-outlined">attach_file</span>
                </label>

                <input
                  type="text"
                  className="clean-text-input"
                  placeholder={
                    activeDocument
                      ? `Ask any question about ${activeDocument}...`
                      : "Upload textbook or notes to ask questions..."
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!activeDocument || thinking}
                  aria-label="Ask question about document"
                />

                <button
                  type="button"
                  className="clean-send-btn"
                  onClick={handleSend}
                  disabled={!activeDocument || !input.trim() || thinking}
                >
                  <span className="material-symbols-outlined">arrow_upward</span>
                </button>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

export default App;
