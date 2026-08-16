import { useState, useEffect, useRef } from "react";
import axios from "axios";
import TechBackground from "./TechBackground";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8000" : "https://help-me-zdr2.onrender.com");

const renderBold = (text) => {
  if (!text) return "";
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const renderMarkdown = (text) => {
  if (!text) return null;
  
  const cleanedText = text.replace(/\[Source\s+\d+(?:,\s*Source\s+\d+)*\]/gi, "");

  const lines = cleanedText.split("\n");
  return lines.map((line, idx) => {
    let content = line;
    
    if (content.startsWith("### ")) {
      return <h4 key={idx} style={{ marginTop: "10px", marginBottom: "6px", fontWeight: "700" }}>{renderBold(content.replace("### ", ""))}</h4>;
    }
    if (content.startsWith("## ")) {
      return <h3 key={idx} style={{ marginTop: "12px", marginBottom: "8px", fontWeight: "700" }}>{renderBold(content.replace("## ", ""))}</h3>;
    }
    
    if (content.trim().startsWith("- ") || content.trim().startsWith("* ")) {
      const bulletText = content.replace(/^[\s]*[-*]\s+/, "");
      return (
        <li key={idx} className="markdown-bullet" style={{ marginLeft: "18px", marginBottom: "4px" }}>
          {renderBold(bulletText)}
        </li>
      );
    }
    
    if (/^\d+\.\s+/.test(content.trim())) {
      const listText = content.replace(/^[\s]*\d+\.\s+/, "");
      const numMatch = content.match(/^\s*(\d+)/);
      const num = numMatch ? numMatch[1] : "1";
      return (
        <div key={idx} className="markdown-list-item" style={{ display: "flex", gap: "6px", marginBottom: "4px" }}>
          <span style={{ fontWeight: "bold" }}>{num}.</span>
          <span>{renderBold(listText)}</span>
        </div>
      );
    }
    
    if (!content.trim()) {
      return <div key={idx} style={{ height: "6px" }} />;
    }
    
    return <p key={idx} style={{ marginBottom: "6px", lineHeight: "1.4" }}>{renderBold(content)}</p>;
  });
};

const getSessionId = () => {
  let sessionId = sessionStorage.getItem("helpme_session_id");
  if (!sessionId) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    sessionStorage.setItem("helpme_session_id", sessionId);
  }
  return sessionId;
};

function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [thinking, setThinking] = useState(false);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (!showLanding) {
      scrollToBottom();
    } else {
      const observerCallback = (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
          } else {
            entry.target.classList.remove("revealed");
          }
        });
      };

      const observerOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -40px 0px",
      };

      const observer = new IntersectionObserver(observerCallback, observerOptions);
      const elements = document.querySelectorAll(".reveal-on-scroll");
      elements.forEach((el) => observer.observe(el));

      return () => {
        elements.forEach((el) => observer.unobserve(el));
        observer.disconnect();
      };
    }
  }, [messages, thinking, showLanding]);

  const uploadFile = async () => {
    if (!file) return;
    setUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const sessionId = getSessionId();
      const response = await axios.post(`${API_BASE}/upload?session_id=${sessionId}`, formData);
      setMessage(response.data.message);
    } catch (err) {
      console.log(err);
      const detail = err.response?.data?.detail;
      setMessage(detail ? `Upload failed: ${detail}` : "Upload Failed");
    }
    setUploading(false);
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
      console.log(err);
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
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!thinking) {
        handleSend();
      }
    }
  };

  const [activeTab, setActiveTab] = useState("research");

  const handleUploadAndRedirect = async (targetFile) => {
    const fileToUpload = targetFile || file;
    if (!fileToUpload) return;

    setUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const sessionId = getSessionId();
      const response = await axios.post(`${API_BASE}/upload?session_id=${sessionId}`, formData);
      setMessage(response.data.message);
      setUploading(false);
      setShowLanding(false);
    } catch (err) {
      console.log(err);
      const detail = err.response?.data?.detail;
      setMessage(detail ? `Upload failed: ${detail}` : "Upload Failed");
      setUploading(false);
    }
  };

  const useCases = {
    research: {
      title: "Academic Research Papers",
      prompt: "What are the core conclusions and experimental methodology of this study?",
      description: "Parses complex multi-column academic papers, mathematical formulas, and literature citations with exact page numbers.",
      tags: ["Multi-column Layouts", "Citations", "Formula Context"]
    },
    resume: {
      title: "Resumes & Essays",
      prompt: "Summarize key work experience, technical stack, and career progression.",
      description: "Extracts key qualifications, project highlights, and skill proficiency directly from candidate documents.",
      tags: ["Skill Mapping", "Career Timeline", "Experience Extraction"]
    },
    manual: {
      title: "Technical Documentation",
      prompt: "What are the installation prerequisites and API config parameters?",
      description: "Navigates dense technical manuals, configuration tables, and software guides to retrieve precise parameters.",
      tags: ["API Specs", "System Prerequisites", "Configuration Tables"]
    },
    financial: {
      title: "Financial Statements & Reports",
      prompt: "What was the year-over-year revenue growth and net operating margin?",
      description: "Leverages cloud vision OCR to transcribe structured balance sheets, financial tables, and quarterly audits.",
      tags: ["Cloud Vision OCR", "Structured Tables", "Financial Metrics"]
    }
  };

  const [activeStepModal, setActiveStepModal] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const pipelineDetails = {
    1: {
      title: "STEP 1: INGESTION & VISION OCR",
      badge: "INGESTION",
      badgeClass: "bg-primary-container",
      description: "Parses standard PDF documents with PyPDFLoader. If extracted text is minimal (<150 characters), automatically triggers PyMuPDF page rendering and Groq Cloud Vision OCR (llama-3.2-11b-vision-preview) to extract un-selectable scanned text and tables.",
      techStack: ["PyPDFLoader", "PyMuPDF (fitz)", "Groq Cloud Vision OCR", "Recursive Text Splitter"]
    },
    2: {
      title: "STEP 2: HYBRID VECTOR & BM25 INDEXING",
      badge: "HYBRID INDEXING",
      badgeClass: "bg-white",
      description: "Generates 384-dimensional dense vector embeddings using HuggingFace sentence-transformers/all-MiniLM-L6-v2 stored in Chroma DB. Simultaneously tokenizes document corpus for sparse BM25 (Best Matching 25) lexical term frequency scoring.",
      techStack: ["HuggingFace Embeddings", "Chroma Vector Database", "BM25Okapi Tokenizer", "SHA-256 Chunk Hashing"]
    },
    3: {
      title: "STEP 3: RECIPROCAL RANK FUSION (RRF)",
      badge: "RRF ROUTING",
      badgeClass: "bg-white",
      description: "Combines dense vector similarity search (top-20) and sparse BM25 term frequency scores (top-20). Ranks retrieved chunks using Reciprocal Rank Fusion formula RRF_score(d) = Σ 1 / (60 + rank_i(d)) to produce the top 5 context chunks.",
      techStack: ["Reciprocal Rank Fusion", "Dense + Sparse Hybrid Search", "Chroma Similarity Search", "Rank Normalization"]
    },
    4: {
      title: "STEP 4: AGENTIC FACT-CHECK & WEB FALLBACK",
      badge: "FACT CHECK",
      badgeClass: "bg-pink",
      description: "LangGraph state machine evaluates retrieved chunk relevance before generation. After creating the answer, an automated evaluator inspects output line-by-line against context. If ungrounded, triggers DuckDuckGo web search fallback.",
      techStack: ["LangGraph StateGraph", "Groq Llama-3.3-70B", "Hallucination Fact Grader", "DuckDuckGo Web Search"]
    }
  };

  const handleCopyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleQuickPrompt = (promptText) => {
    setInput(promptText);
    const fakeEvent = { preventDefault: () => {} };
    setTimeout(() => {
      handleSendWithQuery(promptText);
    }, 50);
  };

  const handleSendWithQuery = async (customQuery) => {
    const question = customQuery || input;
    if (!question.trim()) return;

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
      console.log(err);
      setThinking(false);
      const detail = err.response?.data?.detail;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          sender: "bot",
          text: detail || "Unable to connect to server. Ingest a document first.",
          sources: [],
        },
      ]);
    }
  };

  if (showLanding) {
    return (
      <div className="brutalist-landing-container">
        <TechBackground />
        {/* TopNavBar */}
        <header className="brutalist-header">
          <div className="brutalist-logo">HELPME AI</div>
          <nav className="brutalist-nav">
            <a className="nav-link" href="#pipeline">Pipeline</a>
            <a className="nav-link" href="#capabilities">Capabilities</a>
            <a className="nav-link" href="#whyus">Why Us</a>
            <a className="nav-link" href="#benchmarks">Benchmarks</a>
          </nav>
          <button
            className="brutalist-workspace-btn"
            onClick={() => setShowLanding(false)}
          >
            Open Workspace <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1", fontSize: "18px" }}>arrow_forward</span>
          </button>
        </header>

        <main className="brutalist-main">
          {/* Hero Section */}
          <section className="brutalist-hero">
            <h1 className="brutalist-hero-title reveal-on-scroll">INTELLIGENT DOCUMENT SEARCH &amp; VERIFICATION</h1>

            {/* Drop Box */}
            <div className="brutalist-upload-box reveal-on-scroll delay-1">
              <label className="brutalist-dropzone-label">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const selected = e.target.files[0];
                    setFile(selected);
                    setMessage("");
                    if (selected) {
                      handleUploadAndRedirect(selected);
                    }
                  }}
                />
                <span className="material-symbols-outlined brutalist-upload-icon" style={{ fontVariationSettings: "'FILL' 0" }}>upload_file</span>
                <h2 className="brutalist-upload-title">DROP DOCUMENTS HERE</h2>
                <p className="brutalist-upload-subtitle">Ingest PDFs, Word files, and raw text. Our engine instantly processes, OCRs, and indexes your data for exact retrieval.</p>
                <div className="brutalist-btn-wrap">
                  <span className="brutalist-select-btn">
                    {uploading ? "Ingesting..." : "Select Files"}
                  </span>
                </div>
              </label>
              {message && <div className="brutalist-notification">{message}</div>}
            </div>
          </section>

          {/* Pipeline Section */}
          <section id="pipeline" className="brutalist-section">
            <h2 className="brutalist-section-title reveal-on-scroll">THE RETRIEVAL PIPELINE</h2>
            <div className="brutalist-pipeline-wrapper">
              <div className="brutalist-pipeline-line"></div>

              {/* Step 1 */}
              <div
                className="brutalist-step-card border-primary reveal-on-scroll delay-1 clickable-card"
                onClick={() => setActiveStepModal(1)}
                title="Click for Step 1 Technical Details"
              >
                <div className="brutalist-step-num bg-primary-container">1</div>
                <span className="material-symbols-outlined step-icon text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>cloud_upload</span>
                <h3 className="brutalist-step-heading">INGESTION</h3>
                <p className="brutalist-step-desc">Parallel processing &amp; OCR extraction.</p>
              </div>

              {/* Step 2 */}
              <div
                className="brutalist-step-card border-black reveal-on-scroll delay-2 clickable-card"
                onClick={() => setActiveStepModal(2)}
                title="Click for Step 2 Technical Details"
              >
                <div className="brutalist-step-num bg-white">2</div>
                <span className="material-symbols-outlined step-icon text-white" style={{ fontVariationSettings: "'FILL' 1" }}>schema</span>
                <h3 className="brutalist-step-heading">HYBRID INDEXING</h3>
                <p className="brutalist-step-desc">Dense vectors + BM25 keyword matching.</p>
              </div>

              {/* Step 3 */}
              <div
                className="brutalist-step-card border-black reveal-on-scroll delay-3 clickable-card"
                onClick={() => setActiveStepModal(3)}
                title="Click for Step 3 Technical Details"
              >
                <div className="brutalist-step-num bg-white">3</div>
                <span className="material-symbols-outlined step-icon text-white" style={{ fontVariationSettings: "'FILL' 1" }}>alt_route</span>
                <h3 className="brutalist-step-heading">RRF ROUTING</h3>
                <p className="brutalist-step-desc">Reciprocal Rank Fusion optimization.</p>
              </div>

              {/* Step 4 */}
              <div
                className="brutalist-step-card border-pink reveal-on-scroll delay-4 clickable-card"
                onClick={() => setActiveStepModal(4)}
                title="Click for Step 4 Technical Details"
              >
                <div className="brutalist-step-num bg-pink">4</div>
                <span className="material-symbols-outlined step-icon text-pink" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                <h3 className="brutalist-step-heading">FACT CHECK</h3>
                <p className="brutalist-step-desc">Agentic verification against source chunks.</p>
              </div>
            </div>
          </section>

          {/* Capabilities Section */}
          <section id="capabilities" className="brutalist-section">
            <h2 className="brutalist-section-title-left reveal-on-scroll">CORE CAPABILITIES</h2>
            <div className="brutalist-capabilities-grid">
              {/* Feature 1 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-1">
                <div className="cap-card-header">
                  <div className="cap-badge bg-secondary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>format_quote</span>
                  </div>
                  <h3>EXACT SOURCE CITATIONS</h3>
                </div>
                <p>Every claim generated by the model is backed by a direct, verifiable link to the exact chunk of text in your uploaded documents.</p>
              </div>

              {/* Feature 2 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-2">
                <div className="cap-card-header">
                  <div className="cap-badge bg-primary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>document_scanner</span>
                  </div>
                  <h3>CLOUD VISION OCR</h3>
                </div>
                <p>Extract text from scanned PDFs and images with high precision, making even legacy documents fully searchable and retrievable.</p>
              </div>

              {/* Feature 3 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-3">
                <div className="cap-card-header">
                  <div className="cap-badge bg-tertiary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>join_inner</span>
                  </div>
                  <h3>HYBRID RETRIEVAL</h3>
                </div>
                <p>Combines semantic vector search for context with traditional keyword matching (BM25) to ensure nothing is missed.</p>
              </div>

              {/* Feature 4 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-4">
                <div className="cap-card-header">
                  <div className="cap-badge bg-pink">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>robot_2</span>
                  </div>
                  <h3>FACT VERIFICATION AGENT</h3>
                </div>
                <p>A secondary LLM pass actively checks the initial response against the retrieved context to hallucination-proof the final output.</p>
              </div>
            </div>
          </section>

          {/* Benchmarks Section */}
          <section id="benchmarks" className="brutalist-section">
            <h2 className="brutalist-section-title reveal-on-scroll">SYSTEM BENCHMARKS</h2>
            <div className="brutalist-benchmark-grid">
              {/* Stat 1 */}
              <div className="benchmark-stat-card border-pink reveal-on-scroll delay-1">
                <div className="stat-number text-pink">HIGH</div>
                <div className="stat-label">ACCURACY &amp; FACT CHECK</div>
                <p className="stat-desc">LangGraph agent eliminates hallucinations by verifying answers line-by-line against source documents.</p>
              </div>

              {/* Stat 2 */}
              <div className="benchmark-stat-card border-primary reveal-on-scroll delay-2">
                <div className="stat-number text-primary-container">BETTER</div>
                <div className="stat-label">CONTEXT RECALL</div>
                <p className="stat-desc">Hybrid BM25 keyword matching and vector embeddings deliver superior document search results.</p>
              </div>

              {/* Stat 3 */}
              <div className="benchmark-stat-card border-black reveal-on-scroll delay-3">
                <div className="stat-number text-white">ACCURATE</div>
                <div className="stat-label">VISION OCR</div>
                <p className="stat-desc">Extracts text and complex structured tables from scanned PDFs and image documents with precision.</p>
              </div>

              {/* Stat 4 */}
              <div className="benchmark-stat-card border-black reveal-on-scroll delay-4">
                <div className="stat-number text-white">FAST</div>
                <div className="stat-label">QUERY RESPONSE</div>
                <p className="stat-desc">Ultra-fast multi-node agent processing powered by Groq cloud inference engine.</p>
              </div>
            </div>

            {/* Comparison Table */}
            <div className="brutalist-comparison-wrapper reveal-on-scroll delay-2">
              <h3 className="comparison-table-title">Standard AI vs. HelpMe AI</h3>
              <div className="table-responsive">
                <table className="brutalist-comparison-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Feature</th>
                      <th style={{ width: "35%" }}>Standard AI</th>
                      <th style={{ width: "35%" }} className="highlight-header">HELPME AI</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Fact Checking</strong></td>
                      <td><span className="status-text text-fail">❌ Hallucinates</span></td>
                      <td className="highlight-cell"><span className="status-text text-pass">✓ 100% Fact-Checked</span></td>
                    </tr>
                    <tr>
                      <td><strong>Scanned PDFs</strong></td>
                      <td><span className="status-text text-fail">❌ Cannot Read</span></td>
                      <td className="highlight-cell"><span className="status-text text-pass">✓ Cloud Vision OCR</span></td>
                    </tr>
                    <tr>
                      <td><strong>Search Precision</strong></td>
                      <td><span className="status-text text-warn">⚠️ Basic Search</span></td>
                      <td className="highlight-cell"><span className="status-text text-pass">✓ Hybrid Precision</span></td>
                    </tr>
                    <tr>
                      <td><strong>Page Proof</strong></td>
                      <td><span className="status-text text-fail">❌ None</span></td>
                      <td className="highlight-cell"><span className="status-text text-pass">✓ Direct Page Links</span></td>
                    </tr>
                    <tr>
                      <td><strong>Missing Data</strong></td>
                      <td><span className="status-text text-fail">❌ Guesses Facts</span></td>
                      <td className="highlight-cell"><span className="status-text text-pass">✓ Live Web Search</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Why Choose Us Section */}
          <section id="whyus" className="brutalist-section">
            <h2 className="brutalist-section-title-left reveal-on-scroll">WHY CHOOSE HELPME AI?</h2>
            <div className="brutalist-capabilities-grid">
              {/* Reason 1 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-1">
                <div className="cap-card-header">
                  <div className="cap-badge bg-secondary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  </div>
                  <h3>ZERO HALLUCINATIONS</h3>
                </div>
                <p>Unlike standard AI models that invent answers, our built-in fact checker verifies every line of context before showing results.</p>
              </div>

              {/* Reason 2 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-2">
                <div className="cap-card-header">
                  <div className="cap-badge bg-primary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>visibility</span>
                  </div>
                  <h3>SCANNED PDF OCR</h3>
                </div>
                <p>Effortlessly processes image-only scanned PDFs, financial balance sheets, and handwritten notes using Cloud Vision OCR.</p>
              </div>

              {/* Reason 3 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-3">
                <div className="cap-card-header">
                  <div className="cap-badge bg-tertiary">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>center_focus_strong</span>
                  </div>
                  <h3>HYBRID RETRIEVAL</h3>
                </div>
                <p>Combines semantic vector understanding with exact word matching so you find specific page numbers and figures instantly.</p>
              </div>

              {/* Reason 4 */}
              <div className="brutalist-cap-card reveal-on-scroll delay-4">
                <div className="cap-card-header">
                  <div className="cap-badge bg-pink">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>travel_explore</span>
                  </div>
                  <h3>SMART WEB FALLBACK</h3>
                </div>
                <p>If an answer isn't present in your uploaded document, our agent automatically retrieves verified facts from live web search.</p>
              </div>
            </div>
          </section>
        </main>

        {/* Pipeline Details Modal */}
        {activeStepModal && pipelineDetails[activeStepModal] && (
          <div className="brutalist-modal-overlay" onClick={() => setActiveStepModal(null)}>
            <div className="brutalist-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{pipelineDetails[activeStepModal].title}</h2>
                <button className="modal-close-btn" onClick={() => setActiveStepModal(null)}>&times;</button>
              </div>
              <p className="modal-description">{pipelineDetails[activeStepModal].description}</p>
              <div className="modal-tech-stack">
                <span className="tech-stack-label">ARCHITECTURE COMPONENTS:</span>
                <div className="tech-tags">
                  {pipelineDetails[activeStepModal].techStack.map((tech, idx) => (
                    <span key={idx} className="tech-tag">{tech}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Minimal Clean Footer */}
        <footer className="minimal-footer">
          <div className="minimal-footer-container">
            <div className="minimal-footer-left">
              <span className="minimal-logo">HELPME AI</span>
              <span className="minimal-copy">© 2026 HELPME AI. All rights reserved.</span>
            </div>
            <nav className="minimal-footer-nav">
              <a href="#pipeline">Pipeline</a>
              <a href="#capabilities">Capabilities</a>
              <a href="#whyus">Why Us</a>
              <a href="#benchmarks">Benchmarks</a>
            </nav>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-container animate-fade-in alpha-workspace">
      {/* Cyber-Brutalist Sidebar */}
      <aside className="alpha-sidebar">
        <div className="alpha-brand-header">
          <div className="brand-title-row">
            <span className="material-symbols-outlined brand-rocket">psychology</span>
            <div>
              <h1 className="alpha-brand-title">HELPME AI</h1>
            </div>
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="alpha-nav">
          <button className="alpha-nav-item active">
            <span className="material-symbols-outlined">database</span>
            <span>KNOWLEDGE BASE</span>
          </button>
          <button className="alpha-nav-item" onClick={() => setShowLanding(true)}>
            <span className="material-symbols-outlined">home</span>
            <span>LANDING PAGE</span>
          </button>
        </nav>

        {/* Data Source Ingestion Card */}
        <div className="alpha-data-card">
          <h2 className="data-card-title">DATA SOURCE</h2>
          <p className="data-card-desc">
            Upload PDFs to build a hybrid vector + BM25 search index.
          </p>
          <label className="alpha-ingest-btn">
            <input
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const selected = e.target.files[0];
                if (selected) {
                  setFile(selected);
                  uploadFile();
                }
              }}
            />
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>upload</span>
            <span>{uploading ? "INGESTING..." : "INGEST NEW DATA"}</span>
          </label>
          {file && (
            <span className="ingested-file-tag">📄 {file.name}</span>
          )}
        </div>

        {/* Bottom Sidebar Footer */}
        <div className="alpha-sidebar-bottom">
          <button className="alpha-bottom-link home-link" onClick={() => setShowLanding(true)}>
            <span className="material-symbols-outlined">arrow_back</span>
            <span>BACK TO HOME</span>
          </button>
        </div>

        {message && (
          <div className="notification-banner alpha-toast">
            {message}
          </div>
        )}
      </aside>

      {/* Main Workspace Area */}
      <main className="alpha-main-content">
        <div className="alpha-chat-window">
          {messages.length === 0 && !thinking && (
            <div className="alpha-welcome">
              <div className="welcome-tag">KNOWLEDGE BASE READY</div>
              <h2>Ask Anything Against Your Retrieval Corpus</h2>
              <p>
                Upload PDFs using the sidebar button or click a starter prompt below:
              </p>
              <div className="quick-prompts-row">
                <button className="quick-prompt-chip" onClick={() => handleQuickPrompt("Summarize the key points and core takeaways of this document.")}>
                  💡 Summarize Key Points
                </button>
                <button className="quick-prompt-chip" onClick={() => handleQuickPrompt("Extract all key data points, figures, and structured specifications.")}>
                  📊 Extract Data &amp; Specifications
                </button>
                <button className="quick-prompt-chip" onClick={() => handleQuickPrompt("What are the main conclusions and core findings?")}>
                  ❓ Main Conclusions
                </button>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`alpha-chat-row ${
                msg.sender === "user" ? "alpha-user-row" : "alpha-bot-row"
              }`}
            >
              {msg.sender === "user" ? (
                <div className="alpha-user-card">
                  <div className="alpha-user-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>person</span>
                    <span>USER QUERY</span>
                  </div>
                  <div className="alpha-user-text">{msg.text}</div>
                </div>
              ) : (
                <div className="alpha-bot-card">
                  <div className="alpha-bot-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>memory</span>
                    <span>HELPME AI</span>
                  </div>
                  <div className="alpha-bot-text">{renderMarkdown(msg.text)}</div>
                  
                  {/* Sources Row */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="alpha-sources-row">
                      <span className="sources-label">SOURCES:</span>
                      {msg.sources.map((src, idx) => {
                        if (src.pages === "web") {
                          return (
                            <a
                              key={idx}
                              href={src.source}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="alpha-src-pill web-pill"
                            >
                              🔗 {src.title || "Web Source"}
                            </a>
                          );
                        }
                        return (
                          <span key={idx} className="alpha-src-pill doc-pill">
                            📄 {src.source || "Document"} [Pg {src.pages}]
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <button
                    className="copy-answer-btn alpha-copy-btn"
                    onClick={() => handleCopyText(msg.text, msg.id)}
                  >
                    {copiedId === msg.id ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          ))}

          {thinking && (
            <div className="alpha-chat-row alpha-bot-row">
              <div className="alpha-thinking-bar">
                <span className="thinking-block"></span>
                <span className="thinking-block"></span>
                <span className="thinking-block"></span>
                <span className="thinking-label">SYNTHESIZING CONTEXT...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef}></div>
        </div>

        {/* Bottom Input Dock */}
        <div className="alpha-bottom-dock">
          <div className="alpha-mode-chips">
            <span className="mode-chip highlight-chip">⚡ Hybrid Search RAG</span>
            <span className="mode-chip">🛡️ Hallucination Filter</span>
          </div>

          <div className="alpha-input-container">
            <input
              className="alpha-chat-input"
              type="text"
              placeholder="Ask any question about your document..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={thinking}
            />
            <button
              className="alpha-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || thinking}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>send</span>
              <span>SEND</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;