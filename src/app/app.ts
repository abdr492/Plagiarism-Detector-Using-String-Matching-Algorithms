import { ChangeDetectionStrategy, Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PlagiarismReport, runPlagiarismCheck } from './utils/algorithms';

interface IndexedDocSummary {
  id: string;
  title: string;
  author: string;
  date: string;
  category: string;
  wordCount: number;
}

interface BulkUploadedFile {
  id: string;
  name: string;
  size: string;
  content: string;
  status: 'Ready' | 'Scanning' | 'Done' | 'Failed';
  score: number | null;
  report: PlagiarismReport | null;
}

interface PastReportSummary {
  id: string;
  title: string;
  date: string;
  score: number;
  sentencesCount: number;
  sourceChecked: string;
  isWebChecked: boolean;
  verdict: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly Math = Math;

  // Theme Config States
  themeMode = signal<'light' | 'dark'>('light');
  themeAccent = signal<'indigo' | 'emerald' | 'violet' | 'amber' | 'rose'>('indigo');

  // Navigation
  activeTab = signal<'overview' | 'detect' | 'analysis' | 'bulk' | 'repository' | 'reports'>('overview');

  // Repository and Documents Base
  repositoryList = signal<IndexedDocSummary[]>([]);
  isLoadingRepo = signal<boolean>(false);

  // Active Single Scanning Inputs
  selectedOriginalDocId = signal<string>('kmp-rabin-dsa-paper');
  originalText = signal<string>('');
  submittedText = signal<string>('');
  runWebGrounding = signal<boolean>(false);
  isComparing = signal<boolean>(false);
  comparisonError = signal<string | null>(null);

  // Active Results State
  scanResult = signal<PlagiarismReport | null>(null);
  webScanResult = signal<{
    probability: number;
    verdict: string;
    summary: string;
    paraphrasedObservation?: string;
    suggestedAttributes: { sourceName: string; url: string; excerptMatch: string }[];
  } | null>(null);
  analyzedDocTitle = signal<string>('Submitted Document');
  comparedDocTitle = signal<string>('Original Reference');

  // Interactive Highlighting Line details
  selectedSentenceIndex = signal<number | null>(null);
  comparisonViewMode = signal<'sentences' | 'flow'>('flow');

  submittedFlowSegments = computed(() => {
    const text = this.submittedText() || '';
    const result = this.scanResult();
    if (!result) return [];

    const sentenceMatches = text.match(/[^.!?]+[.!?]*/g) || [text];
    const activeSentences = result.sentences || [];

    return sentenceMatches
      .map((segmentText) => {
        const trimmed = segmentText.trim();
        if (!trimmed) return null;

        const foundIdx = activeSentences.findIndex(s => {
          const cleanSub = s.submittedText.toLowerCase().replace(/[^\w]/g, '');
          const cleanSeg = trimmed.toLowerCase().replace(/[^\w]/g, '');
          return cleanSub === cleanSeg || cleanSub.includes(cleanSeg) || cleanSeg.includes(cleanSub);
        });

        if (foundIdx !== -1) {
          const matchedSentence = activeSentences[foundIdx];
          return {
            text: segmentText,
            matched: true,
            algorithm: matchedSentence.algorithm,
            sentenceIndex: foundIdx as number | null,
            similarity: matchedSentence.similarity
          };
        }

        return {
          text: segmentText,
          matched: false,
          algorithm: undefined,
          sentenceIndex: null as number | null,
          similarity: undefined
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  });

  originalFlowSegments = computed(() => {
    const text = this.originalText() || '';
    const result = this.scanResult();
    if (!result) return [];

    const sentenceMatches = text.match(/[^.!?]+[.!?]*/g) || [text];
    const activeSentences = result.sentences || [];

    return sentenceMatches
      .map((segmentText) => {
        const trimmed = segmentText.trim();
        if (!trimmed) return null;

        const foundIdx = activeSentences.findIndex(s => {
          const cleanSub = s.matchedText.toLowerCase().replace(/[^\w]/g, '');
          const cleanSeg = trimmed.toLowerCase().replace(/[^\w]/g, '');
          return cleanSub === cleanSeg || cleanSub.includes(cleanSeg) || cleanSeg.includes(cleanSub);
        });

        if (foundIdx !== -1) {
          const matchedSentence = activeSentences[foundIdx];
          return {
            text: segmentText,
            matched: true,
            algorithm: matchedSentence.algorithm,
            sentenceIndex: foundIdx as number | null,
            similarity: matchedSentence.similarity
          };
        }

        return {
          text: segmentText,
          matched: false,
          algorithm: undefined,
          sentenceIndex: null as number | null,
          similarity: undefined
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  });

  // Bulk Upload state
  bulkFiles = signal<BulkUploadedFile[]>([]);
  isBulkScanning = signal<boolean>(false);

  // Repository Admin Form
  repoForm = new FormGroup({
    title: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    author: new FormControl('', [Validators.required, Validators.maxLength(50)]),
    category: new FormControl('Computer Science', [Validators.required]),
    content: new FormControl('', [Validators.required, Validators.minLength(100)])
  });
  repoError = signal<string | null>(null);
  repoSuccessMessage = signal<string | null>(null);

  // Archive Logs
  reportsHistory = signal<PastReportSummary[]>([]);

  // Derived Benchmark speeds based on length for display (visual sandbox)
  benchmarkData = computed(() => {
    const textLen = this.submittedText().length;
    if (textLen === 0) return { naive: 0.05, rabinKarp: 0.15, kmp: 0.06 };
    // Realistic microsecond multipliers for physical complexity demo
    const norm = Math.max(1, textLen / 200);
    return {
      naive: Number((0.024 * norm * norm).toFixed(4)),      // O(N*M)
      rabinKarp: Number((0.051 * norm * 1.1).toFixed(4)), // O(N+M) on average
      kmp: Number((0.018 * norm * 0.95).toFixed(4))       // O(N+M)
    };
  });

  ngOnInit() {
    this.loadThemeSettings();
    this.fetchRepository();
    this.loadHistoryFromLocalStorage();

    // Load initial original text mapping
    setTimeout(() => {
      this.handleOriginalDocChange(this.selectedOriginalDocId());
    }, 400);
  }

  // Fetch repositories indexed on node server
  async fetchRepository() {
    this.isLoadingRepo.set(true);
    try {
      const res = await fetch('/api/repository/list');
      if (res.ok) {
        const data = await res.json();
        this.repositoryList.set(data);
      }
    } catch {
      console.warn('Backend server unreachable. Using fallback seed records client-side.');
      // Fallback
      this.repositoryList.set([
        { id: 'kmp-rabin-dsa-paper', title: 'An Analysis of String Matching Algorithms for Pattern Detection', author: 'Dr. Sarah Jenkins', date: '2025-10-14', category: 'Computer Science', wordCount: 165 },
        { id: 'climate-change-impacts', title: 'Climate Change Impacts on Global Meteorological Microclimates', author: 'Prof. Robert Chen', date: '2026-01-20', category: 'Environmental Science', wordCount: 180 },
        { id: 'academic-integrity-survey', title: 'Academic Integrity and the Evolution of Anti-Plagiarism Frameworks', author: 'Alice Carter, M.Ed.', date: '2025-05-08', category: 'Academic Research', wordCount: 175 },
        { id: 'quantum-computing-era', title: 'Practical Quantum Computation and Cryptographic Security Limits', author: 'Dr. Evelyn Foster', date: '2026-03-30', category: 'Physics & Engineering', wordCount: 185 }
      ]);
    } finally {
      this.isLoadingRepo.set(false);
    }
  }

  // Pre-fill Original documents to read pane
  async handleOriginalDocChange(docId: string) {
    this.selectedOriginalDocId.set(docId);
    if (!docId) {
      this.originalText.set('');
      return;
    }

    try {
      // Find within seed or make local lookups
      if (docId === 'kmp-rabin-dsa-paper') {
        this.originalText.set("The knuthmorrispratt or kmp algorithm analyzes the pattern beforehand to build a prefix table. This table, called the longest prefix suffix or lps array, allows the search to skip redundant character comparisons. KMP runs in linear time O(n + m), which makes it highly efficient for static pattern matching in massive text datasets. On the other hand, the rabinkarp algorithm uses rolling hashes to compare the pattern with substrings of the text. By checking hash values instead of matching characterbycharacter, rabinkarp achieves high efficiency on average O(n + m). However, in the worst-case scenario when hash collisions occur frequently, its complexity degrades to O(n * m). For modern plagiarism checkers, combining these exact matching algorithms with fingerprinting systems like Stanford's Moss winnowing provides a balanced, robust pipeline. Winnowing slices the document into n-grams, hashes them, and selects a sparse set of hashes within a sliding window. This sparse grid of hashes functions as a digital signature, allowing matching even under light paraphrasing or text rearrangement.");
        this.comparedDocTitle.set("Dr. Sarah Jenkins' DSA Paper");
      } else if (docId === 'climate-change-impacts') {
        this.originalText.set("Climate change means long term changes in global temperatures and weather conditions. These shifts can be completely natural, but since the 1800s, human activities have been the primary cause of climate change, mainly through burning of fossil fuels like coal, petroleum, and natural gas. Combustion of fossil fuels emits massive greenhouse gases including carbon dioxide, methane, and nitrous oxide, which act as a dense blanket wrapped around the Earth, trapping warmth and increasing average temperatures. Over the last century, this warming has threatened crucial ecosystems, causing rapid glaciers melting, sea level rising, and severe draughts. Meteorological indicators from research stations show extreme precipitation changes and more frequent oceanic storm surges, redefining the ecological dynamics of coastal microclimates worldwide. Action must be taken immediately to cut greenhouse gas emissions by introducing clean, renewable energy sources such as solar solar pane arrays, wind kinetic turbines, and thermodynamic hydrothermal systems.");
        this.comparedDocTitle.set("Prof. Robert Chen's Climate Article");
      } else if (docId === 'academic-integrity-survey') {
        this.originalText.set("Academic integrity and honesty represent the bedrock of scientific discovery and higher education. Plagiarism is defined as the representation of another author's work, ideas, or expressions as one's own without proper citation. Historically, identifying copy-paste academic plagiarism was a manual process reliant on professors recognizing sudden stylistic variations. Over the last three decades, digital submissions have enabled automated plagiarism engines. Classic approaches use simple n-gram matches and character-level edit distances. Modern pipelines combine multiple tiers: exact phrase trackers using linear prefix state machines, near-duplicate hashing engines utilizing MinHash with Locality-Sensitive Hashing, and deep learning engines calculating semantic similarity. Academic institutions utilize these frameworks not merely as punitive measures, but as educational opportunities to tutor students on scholarly citation practices and intellectual property rights.");
        this.comparedDocTitle.set("Alice Carter's Survey Paper");
      } else if (docId === 'quantum-computing-era') {
        this.originalText.set("Quantum computing represents a paradigm shift in computing speed and problem-solving capacities. Traditional computers process information in bits representing either zero or one. Quantum systems exploit qubits, which leverage superposition and quantum entanglement to evaluate multiple states simultaneously. This exponential processing scaling allows quantum algorithms, such as Shor's algorithm, to factor large integers rapidly and solve discrete logarithms in polynomial time. Consequently, this poses a monumental challenge to current cryptographic protocols, potentially breaking RSA and Elliptic Curve Cryptography (ECC). Researchers are actively developing post-quantum cryptography (PQC) standards designed to resist quantum attacks. These algorithms leverage lattice-based cryptography, multivariate quadratic equations, and error-correcting codes to safeguard critical infrastructure and preserve digital privacy in the quantum supremacy era.");
        this.comparedDocTitle.set("Dr. Evelyn Foster's Quantum Essay");
      } else {
        // Query server/custom if needed
        const req = await fetch('/api/repository/list');
        const repo = await req.json();
        const doc = repo.find((d: { id: string; title: string; content?: string }) => d.id === docId);
        if (doc) {
          // Since server summaries exclude full text, fetch the list details if needed, or scan directly
          // For simplicity we extract content or let it scan
          this.comparedDocTitle.set(doc.title);
          this.originalText.set(doc.content || "Custom document containing indexed research structure.");
        }
      }
    } catch {
       this.comparedDocTitle.set("Custom Repository Work");
    }
  }

  // Load sample texts instantly for demonstration
  loadSample(type: 'copied' | 'paraphrased' | 'clean') {
    if (type === 'copied') {
      this.selectedOriginalDocId.set('kmp-rabin-dsa-paper');
      this.handleOriginalDocChange('kmp-rabin-dsa-paper');
      this.submittedText.set("The knuthmorrispratt or kmp algorithm analyzes the pattern beforehand to build a prefix table. By checking hash values instead of matching characterbycharacter, rabinkarp achieves high efficiency on average. However, in the worst-case scenario when hash collisions occur frequently, its complexity degrades to quadratic models.");
      this.analyzedDocTitle.set("Student DSA Copy Draft.txt");
    } else if (type === 'paraphrased') {
      this.selectedOriginalDocId.set('climate-change-impacts');
      this.handleOriginalDocChange('climate-change-impacts');
      this.submittedText.set("Climate change refers to extensive fluctuations in planetary temperatures and atmospheric weather patterns. These trends are sometimes organic, but over the past two centuries, anthropogenic emissions remain the absolute source, mainly from roasting fossil fuels such as coal or petroleum gas. This thermal combustion launches greenhouse gases comprising carbon dioxide and methane, which construct an atmospheric blanket enclosing the Earth, increasing solar retention.");
      this.analyzedDocTitle.set("Climate Change Synopsis Paraphrase.txt");
    } else {
      this.selectedOriginalDocId.set('academic-integrity-survey');
      this.handleOriginalDocChange('academic-integrity-survey');
      this.submittedText.set("In this research paper, we introduce a brand new architecture for studying genetic biological mutations in cellular membranes. Using advanced cellular sequencing techniques and digital fluid microscopes, we captured exact cellular transitions under different fluid constraints.");
      this.analyzedDocTitle.set("Original Bio Sequencing Research.txt");
    }
  }

  // Primary Plagiarism Checker Action
  async triggerComparison() {
    const textToAnalyze = this.submittedText();

    if (!textToAnalyze || textToAnalyze.trim().length < 5) {
      this.comparisonError.set('Please type or upload a substantial document containing text to scan.');
      return;
    }

    this.comparisonError.set(null);
    this.isComparing.set(true);
    this.selectedSentenceIndex.set(null);

    try {
      // 1. Run detailed local matching math
      const localReport = runPlagiarismCheck(textToAnalyze, this.originalText(), this.comparedDocTitle());
      this.scanResult.set(localReport);

      // 2. Run Gemini NLP analysis if selected
      if (this.runWebGrounding()) {
        try {
          const webRes = await fetch('/api/scan/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToAnalyze })
          });
          if (webRes.ok) {
            const webData = await webRes.json();
            this.webScanResult.set(webData);

            // Re-weight or adjust overall score slightly based on genuine web plagiarism confirmation
            if (webData.probability > localReport.overallScore) {
              const weightedOverall = Math.round((localReport.overallScore * 0.4) + (webData.probability * 0.6));
              localReport.overallScore = weightedOverall;
              this.scanResult.set({ ...localReport });
            }
          }
        } catch (e) {
          console.error('Web integrity audit failed', e);
        }
      } else {
        this.webScanResult.set(null);
      }

      // Add to archive audit trail
      this.archiveReport(localReport);

      // Instantly open the Analysis view to see details
      this.activeTab.set('analysis');

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Class-level verification pipeline encountered a failure.';
      this.comparisonError.set(errorMsg);
    } finally {
      this.isComparing.set(false);
    }
  }

  // Handle Drag & Drop uploading of text files
  onFileDropped(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processUploadedFiles(files);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      this.processUploadedFiles(files);
    }
  }

  // Process files bulk/singularly
  processUploadedFiles(files: FileList) {
    // Trigger state based on tab
    const tab = this.activeTab();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lowerName = file.name.toLowerCase();

      // Support txt file formats
      if (lowerName.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          if (tab === 'bulk') {
            this.bulkFiles.update(current => [
              ...current,
              {
                id: `bulk-${Date.now()}-${i}`,
                name: file.name,
                size: `${(file.size / 1024).toFixed(1)} KB`,
                content: text,
                status: 'Ready',
                score: null,
                report: null
              }
            ]);
          } else {
            // Fill single upload slots
            this.submittedText.set(text);
            this.analyzedDocTitle.set(file.name);
          }
        };
        reader.readAsText(file);
      } else {
        // Mock extract PDF and DOCX structural sentences
        // This simulates decoding libraries seamlessly, keeping server performant
        const originalName = file.name;
        // Generate academic structures based on file headers
        const sizeStr = `${(file.size / 1024).toFixed(1)} KB`;
        const simulatedText = this.generateFileMockTexts(file.name);

        if (tab === 'bulk') {
          this.bulkFiles.update(current => [
            ...current,
            {
              id: `bulk-${Date.now()}-${i}`,
              name: originalName,
              size: sizeStr,
              content: simulatedText,
              status: 'Ready',
              score: null,
              report: null
            }
          ]);
        } else {
          this.submittedText.set(simulatedText);
          this.analyzedDocTitle.set(originalName);
        }
      }
    }
  }

  // Generating mock academic texts for PDF and DOCX attachments so the demo runs gracefully
  generateFileMockTexts(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('research') || lower.includes('algorithm') || lower.includes('dsa')) {
      return "The knuthmorrispratt or kmp algorithm analyzes the pattern beforehand to build a prefix table. This table, called the longest prefix suffix or lps array, allows the search to skip redundant character comparisons. Additionally, the rabinkarp algorithm uses rolling hashes to compare the pattern with substrings of the text efficiently under quadratic O(n*m) constraints.";
    }
    if (lower.includes('climate') || lower.includes('weather') || lower.includes('carbon')) {
      return "Climate change means long term changes in global temperatures and weather conditions. Combustion of fossil fuels emits massive greenhouse gases including carbon dioxide, methane, and nitrous oxide, which act as a dense blanket wrapped around the Earth, trapping warmth.";
    }
    return `Analysis Report for PDF document: ${filename}. This file introduces standard thesis frameworks. Modern plagiarisms are calculated sentence-by-sentence. We analyze exact phrase trackers using linear prefix state machines, near-duplicate hashing engines utilizing MinHash, and deep learning engines calculating semantic similarity.`;
  }

  // Run scans on all bulk files against repository simultaneously
  async runBulkScans() {
    const files = this.bulkFiles();
    if (files.length === 0) return;

    this.isBulkScanning.set(true);

    // Scan each file with 400ms interval for stunning visual animation
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.status === 'Done') continue;

      this.bulkFiles.update(current => {
        const next = [...current];
        next[i] = { ...next[i], status: 'Scanning' };
        return next;
      });

      await new Promise(resolve => setTimeout(resolve, 800));

      try {
        // Compare with our seeded original texts
        const report = runPlagiarismCheck(file.content, this.originalText(), this.comparedDocTitle());

        this.bulkFiles.update(current => {
          const next = [...current];
          next[i] = {
            ...next[i],
            status: 'Done',
            score: report.overallScore,
            report: report
          };
          return next;
        });

        // Add each to history
        this.archiveReport(report, file.name);

      } catch {
        this.bulkFiles.update(current => {
          const next = [...current];
          next[i] = { ...next[i], status: 'Failed' };
          return next;
        });
      }
    }

    this.isBulkScanning.set(false);
  }

  clearBulk() {
    this.bulkFiles.set([]);
  }

  // Add Item to Server Indexed Database
  async submitToRepository() {
    if (this.repoForm.invalid) {
      this.repoError.set('Please make sure all fields are filled. Content must be at least 100 characters.');
      return;
    }

    this.repoError.set(null);
    this.repoSuccessMessage.set(null);
    const formVals = this.repoForm.value;

    try {
      const res = await fetch('/api/repository/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formVals)
      });

      if (res.ok) {
        const data = await res.json();
        this.repoSuccessMessage.set(data.message || 'Document indexed successfully!');
        this.repoForm.reset({ category: 'Computer Science' });
        this.fetchRepository();
      } else {
        const errData = await res.json();
        this.repoError.set(errData.error || 'Server rejected the indexing request.');
      }
    } catch {
      // Offline fallback
      const mockDoc: IndexedDocSummary = {
        id: `custom-doc-${Date.now()}`,
        title: formVals.title!,
        author: formVals.author || 'Scholarly Writer',
        date: new Date().toISOString().split('T')[0],
        category: formVals.category!,
        wordCount: formVals.content!.split(/\s+/).filter(w => w.length > 0).length
      };

      this.repositoryList.update(current => [...current, mockDoc]);
      this.repoSuccessMessage.set('Indexed successfully (Saved client-side).');
      this.repoForm.reset({ category: 'Computer Science' });
    }
  }

  // Remove Item from Database
  async deleteFromRepository(docId: string, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to remove this document from the scanning index?')) return;

    try {
      const res = await fetch(`/api/repository/${docId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        this.fetchRepository();
      }
    } catch {
      // Local fallback
      this.repositoryList.update(current => current.filter(d => d.id !== docId));
    }
  }

  // Repository multi-selection state
  selectedRepoIds = signal<Record<string, boolean>>({});

  toggleRepoSelection(docId: string, event: Event) {
    event.stopPropagation();
    this.selectedRepoIds.update(current => {
      const updated = { ...current };
      updated[docId] = !updated[docId];
      return updated;
    });
  }

  isRepoSelected(docId: string): boolean {
    return !!this.selectedRepoIds()[docId];
  }

  get selectedRepoCount(): number {
    return Object.keys(this.selectedRepoIds()).filter(id => this.selectedRepoIds()[id]).length;
  }

  isAllReposSelected(): boolean {
    const list = this.repositoryList();
    if (list.length === 0) return false;
    return list.every(doc => this.selectedRepoIds()[doc.id]);
  }

  toggleSelectAllRepos() {
    const list = this.repositoryList();
    if (this.isAllReposSelected()) {
      // Clear selection
      this.selectedRepoIds.set({});
    } else {
      // Select all
      const updated: Record<string, boolean> = {};
      list.forEach(doc => {
        updated[doc.id] = true;
      });
      this.selectedRepoIds.set(updated);
    }
  }

  async deleteSelectedFromRepository() {
    const selectedIds = Object.keys(this.selectedRepoIds()).filter(id => this.selectedRepoIds()[id]);
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to remove the ${selectedIds.length} selected document(s) from the scanning index?`)) return;

    try {
      // Run deletions in parallel or sequential
      await Promise.all(
        selectedIds.map(docId =>
          fetch(`/api/repository/${docId}`, {
            method: 'DELETE'
          }).catch(e => console.warn('Failed to delete', docId, e))
        )
      );
    } catch {
      // Offline / error
    } finally {
      // Update local state and fetch fresh data
      this.repositoryList.update(current => current.filter(d => !selectedIds.includes(d.id)));
      this.selectedRepoIds.set({});
      this.fetchRepository();
    }
  }

  // Reports Log Storage
  archiveReport(report: PlagiarismReport, specialTitle?: string) {
    const verdict = report.overallScore > 40
      ? 'High Risk'
      : report.overallScore > 15
        ? 'Moderate Risk'
        : 'Clean';

    const newPast: PastReportSummary = {
      id: `report-${Date.now()}`,
      title: specialTitle || this.analyzedDocTitle(),
      date: new Date().toLocaleTimeString() + ' ' + new Date().toLocaleDateString(),
      score: report.overallScore,
      sentencesCount: report.sentencesAnalyzed,
      sourceChecked: this.comparedDocTitle(),
      isWebChecked: this.runWebGrounding(),
      verdict
    };

    this.reportsHistory.update(current => {
      const updated = [newPast, ...current].slice(0, 50); // limit 50 logs
      localStorage.setItem('plag_scores_history', JSON.stringify(updated));
      return updated;
    });
  }

  loadHistoryFromLocalStorage() {
    if (typeof window !== 'undefined') {
      const items = localStorage.getItem('plag_scores_history');
      if (items) {
        try {
          this.reportsHistory.set(JSON.parse(items));
        } catch {
          this.reportsHistory.set([]);
        }
      }
    }
  }

  clearHistory() {
    if (confirm('Delete all archived plagiarism scan histories?')) {
      localStorage.removeItem('plag_scores_history');
      this.reportsHistory.set([]);
    }
  }

  // View historical results
  viewPastReport(item: PastReportSummary) {
    // Generate a quick report matching the score
    const dummyReport = runPlagiarismCheck(this.submittedText() || "Exact sentences mapped for past plagiarism overview log.", this.originalText());
    dummyReport.overallScore = item.score;
    // Map properties
    this.scanResult.set(dummyReport);
    this.analyzedDocTitle.set(item.title);
    this.webScanResult.set(null); // Clear web
    this.activeTab.set('analysis');
  }

  getSegmentClass(segment: { matched: boolean; algorithm?: string | null; sentenceIndex?: number | null }) {
    if (!segment.matched) {
      return 'text-slate-605 text-slate-600 hover:bg-slate-100/40 rounded transition duration-150 px-1 py-0.5 leading-relaxed';
    }

    const isSelected = this.selectedSentenceIndex() === segment.sentenceIndex;
    let base = 'inline transition duration-200 px-1 py-0.5 rounded cursor-pointer leading-relaxed ';

    if (isSelected) {
      base += 'ring-2 ring-indigo-600 ring-offset-1 font-semibold ';
    }

    switch (segment.algorithm) {
      case 'KMP':
        base += 'bg-violet-100 dark:bg-violet-950/50 text-violet-900 dark:text-violet-200 border-b-2 border-violet-400';
        break;
      case 'Rabin-Karp':
        base += 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-b-2 border-amber-400';
        break;
      case 'Winnowing':
        base += 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-b-2 border-emerald-400';
        break;
      default:
        base += 'bg-rose-100 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 border-b-2 border-rose-400';
        break;
    }

    return base.trim();
  }

  getSegmentTitle(segment: { matched: boolean; algorithm?: string | null; similarity?: number | null }) {
    if (!segment.matched) return 'Original text segment';
    const algoName = segment.algorithm === 'KMP'
      ? 'KMP Pattern Matching'
      : segment.algorithm === 'Rabin-Karp'
        ? 'Rabin-Karp Rolling Hash'
        : segment.algorithm === 'Winnowing'
          ? 'MOSS Winnowing Fingerprint'
          : 'Direct Substring Alignment';
    return `${algoName} detected ${segment.similarity}% match. Click to focus correlation context.`;
  }

  // Helper getters to build polar radar coordinates cleanly in SVG
  get radarPoints(): string {
    const metrics = this.scanResult()?.metrics;
    if (!metrics) return '150,150'; // center fallback

    const scores = [
      metrics.winnowing,
      metrics.rabinKarp,
      metrics.kmp,
      metrics.lcs,
      metrics.levenshtein,
      metrics.jaccard,
      metrics.cosine
    ];

    const center = 150;
    const maxRadius = 100;
    const points: string[] = [];

    // Map 7 vertices corresponding to each algorithm score
    scores.forEach((val, idx) => {
      const angle = (idx * 2 * Math.PI) / 7 - Math.PI / 2;
      const r = (val / 100) * maxRadius;
      // Safeguard minima so point visualizes clearly
      const radius = Math.max(5, r);
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });

    return points.join(' ');
  }

  // Radial index calculation helpers for circles
  get gaugeDashOffset(): number {
    const score = this.scanResult()?.overallScore || 0;
    const circumference = 2 * Math.PI * 80; // r=80
    return circumference - (score / 100) * circumference;
  }

  // Theme action helpers
  toggleMode() {
    const nextMode = this.themeMode() === 'light' ? 'dark' : 'light';
    this.themeMode.set(nextMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('plag_theme_mode', nextMode);
    }
  }

  setAccent(accent: 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose') {
    this.themeAccent.set(accent);
    if (typeof window !== 'undefined') {
      localStorage.setItem('plag_theme_accent', accent);
    }
  }

  loadThemeSettings() {
    if (typeof window !== 'undefined') {
      const mode = localStorage.getItem('plag_theme_mode') as 'light' | 'dark';
      if (mode) {
        this.themeMode.set(mode);
      }
      const accent = localStorage.getItem('plag_theme_accent') as 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose';
      if (accent) {
        this.themeAccent.set(accent);
      }
    }
  }

  getThemeClasses(): string {
    return `theme-mode-${this.themeMode()} theme-accent-${this.themeAccent()}`;
  }
}
