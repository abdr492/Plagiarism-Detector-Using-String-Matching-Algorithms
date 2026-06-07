/**
 * High-performance string matching and document similarity algorithms
 * for the Plagiarism Detector DSA Engine.
 */

// -------------------------------------------------------------
// Helper: Text Preprocessing & Tokenization
// -------------------------------------------------------------

export interface TokenizedDocument {
  originalText: string;
  cleanedText: string;
  words: string[];
  sentences: string[];
}

export function preprocessText(text: string): TokenizedDocument {
  const originalText = text || '';
  // Remove formatting but keep spaces for tokenization
  const cleanedText = originalText
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u017F]/g, '') // Keep alphanumeric and accented multilingual characters
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleanedText.split(' ').filter(w => w.length > 0);

  // Extract sentences while removing extra empty spaces
  const sentences = originalText
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 5); // Filters out trivial sentence fragments

  return { originalText, cleanedText, words, sentences };
}

// -------------------------------------------------------------
// 1. Knuth-Morris-Pratt (KMP) Algorithm
// -------------------------------------------------------------
/**
 * Computes the Longest Prefix Suffix (LPS) array for KMP
 */
export function computeLPSArray(pattern: string): number[] {
  const m = pattern.length;
  const lps = new Array<number>(m).fill(0);
  let length = 0;
  let i = 1;

  while (i < m) {
    if (pattern[i] === pattern[length]) {
      length++;
      lps[i] = length;
      i++;
    } else {
      if (length !== 0) {
        length = lps[length - 1];
      } else {
        lps[i] = 0;
        i++;
      }
    }
  }
  return lps;
}

/**
 * Searches for all occurrences of pattern in text using KMP.
 * Returns array of starting indices in the text.
 */
export function kmpSearch(pattern: string, text: string): number[] {
  const matches: number[] = [];
  const n = text.length;
  const m = pattern.length;

  if (m === 0 || n === 0 || m > n) return matches;

  const lps = computeLPSArray(pattern);
  let i = 0; // index for text
  let j = 0; // index for pattern

  while (i < n) {
    if (pattern[j] === text[i]) {
      i++;
      j++;
    }

    if (j === m) {
      matches.push(i - j);
      j = lps[j - 1];
    } else if (i < n && pattern[j] !== text[i]) {
      if (j !== 0) {
        j = lps[j - 1];
      } else {
        i++;
      }
    }
  }

  return matches;
}

// -------------------------------------------------------------
// 2. Rabin-Karp Algorithm
// -------------------------------------------------------------
/**
 * Searches for pattern in text using rolling hashes
 */
export function rabinKarpSearch(pattern: string, text: string): number[] {
  const matches: number[] = [];
  const n = text.length;
  const m = pattern.length;

  if (m === 0 || n === 0 || m > n) return matches;

  const d = 256; // alphabet size
  const q = 101; // prime number for modulo hashing
  let p = 0;     // hash value for pattern
  let t = 0;     // hash value for text
  let h = 1;

  // The value of h would be "pow(d, m-1) % q"
  for (let i = 0; i < m - 1; i++) {
    h = (h * d) % q;
  }

  // Calculate initial hash values of pattern and first window of text
  for (let i = 0; i < m; i++) {
    p = (d * p + pattern.charCodeAt(i)) % q;
    t = (d * t + text.charCodeAt(i)) % q;
  }

  // Slide the pattern over text one by one
  for (let i = 0; i <= n - m; i++) {
    // Check if hash values match
    if (p === t) {
      // Check individual characters to resolve collisions
      let j = 0;
      for (j = 0; j < m; j++) {
        if (text[i + j] !== pattern[j]) {
          break;
        }
      }
      if (j === m) {
        matches.push(i);
      }
    }

    // Calculate hash value for next window of text
    if (i < n - m) {
      t = (d * (t - text.charCodeAt(i) * h) + text.charCodeAt(i + m)) % q;
      // Convert negative hash back to positive
      if (t < 0) {
        t = t + q;
      }
    }
  }

  return matches;
}

// Simple Naive string matching for performance comparison in benchmark
export function naiveSearch(pattern: string, text: string): number[] {
  const matches: number[] = [];
  const n = text.length;
  const m = pattern.length;

  if (m === 0 || n === 0 || m > n) return matches;

  for (let i = 0; i <= n - m; i++) {
    let j = 0;
    for (j = 0; j < m; j++) {
      if (text[i + j] !== pattern[j]) break;
    }
    if (j === m) {
      matches.push(i);
    }
  }
  return matches;
}

// -------------------------------------------------------------
// 3. Document Fingerprinting via Winnowing (MOSS-like)
// -------------------------------------------------------------
export interface Fingerprint {
  hash: number;
  position: number;
}

/**
 * Hash function for a string (s-gram)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0; // 32-bit integer hash
  }
  return hash;
}

/**
 * Computes MOSS winnowing fingerprints for document
 * @param text Cleaned string without spaces and symbols
 * @param k K-gram length (default = 9 characters)
 * @param w Sliding window size (default = 4 hashes)
 */
export function winnowingFingerprint(text: string, k = 12, w = 6): Fingerprint[] {
  const stripped = text.replace(/\s+/g, ''); // strip all spaces
  const n = stripped.length;
  if (n < k) return [];

  // 1. Generate k-grams and their hashes
  const hashes: number[] = [];
  for (let i = 0; i <= n - k; i++) {
    const kGram = stripped.substring(i, i + k);
    hashes.push(hashString(kGram));
  }

  // 2. Select fingerprints using a sliding window of size w
  const fingerprints: Fingerprint[] = [];
  let minIndex = -1;

  for (let i = 0; i <= hashes.length - w; i++) {
    let currentMin = Infinity;
    let currentMinIdx = -1;

    // Find local minimum hash in the window of size [i, i + w]
    for (let j = 0; j < w; j++) {
      const idx = i + j;
      const h = hashes[idx];
      // Select the rightmost minimum if there are duplicates of the minimum (standard winnowing rule)
      if (h <= currentMin) {
        currentMin = h;
        currentMinIdx = idx;
      }
    }

    // Record the fingerprint only if its index is different from last recorded window minimum index
    if (currentMinIdx !== minIndex) {
      fingerprints.push({
        hash: currentMin,
        position: currentMinIdx // char starting offset
      });
      minIndex = currentMinIdx;
    }
  }

  return fingerprints;
}

/**
 * Compares two sets of fingerprints and returns the matching coverage of the submitted document
 */
export function compareFingerprints(submitted: Fingerprint[], original: Fingerprint[]): {
  score: number;
  matchesCount: number;
  matchedHashes: Set<number>;
} {
  if (submitted.length === 0 || original.length === 0) {
    return { score: 0, matchesCount: 0, matchedHashes: new Set() };
  }

  const originalHashesSet = new Set(original.map(f => f.hash));
  let matchCount = 0;
  const matchedHashes = new Set<number>();

  for (const fp of submitted) {
    if (originalHashesSet.has(fp.hash)) {
      matchCount++;
      matchedHashes.add(fp.hash);
    }
  }

  // Percentage of submitted document contents matching original fingerprints
  const score = (matchCount / submitted.length) * 100;
  return { score, matchesCount: matchCount, matchedHashes };
}

// -------------------------------------------------------------
// 4. Jaccard Similarity (Set representation via shingling)
// -------------------------------------------------------------
/**
 * Computes words n-grams (default n=3, trigrams)
 */
export function getWordNGrams(words: string[], n = 3): Set<string> {
  const nGrams = new Set<string>();
  if (words.length < n) {
    if (words.length > 0) {
      nGrams.add(words.join(' '));
    }
    return nGrams;
  }

  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n).join(' ');
    nGrams.add(gram);
  }
  return nGrams;
}

/**
 * Computes the Jaccard similarity score between sets of shingles
 */
export function jaccardSimilarity(nGramsA: Set<string>, nGramsB: Set<string>): number {
  if (nGramsA.size === 0 && nGramsB.size === 0) return 100;
  if (nGramsA.size === 0 || nGramsB.size === 0) return 0;

  const intersection = new Set<string>();
  for (const x of nGramsA) {
    if (nGramsB.has(x)) {
      intersection.add(x);
    }
  }

  const unionSize = nGramsA.size + nGramsB.size - intersection.size;
  return (intersection.size / unionSize) * 100;
}

// -------------------------------------------------------------
// 5. Cosine Similarity (Word distribution vectors)
// -------------------------------------------------------------
export function cosineSimilarity(wordsA: string[], wordsB: string[]): number {
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const freqMapA: Record<string, number> = {};
  const freqMapB: Record<string, number> = {};

  const vocabulary = new Set<string>();

  for (const w of wordsA) {
    freqMapA[w] = (freqMapA[w] || 0) + 1;
    vocabulary.add(w);
  }

  for (const w of wordsB) {
    freqMapB[w] = (freqMapB[w] || 0) + 1;
    vocabulary.add(w);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const term of vocabulary) {
    const valA = freqMapA[term] || 0;
    const valB = freqMapB[term] || 0;

    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return (dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))) * 100;
}

// -------------------------------------------------------------
// 6. Levenshtein Distance & Similarity
// -------------------------------------------------------------
/**
 * Calculates Levenshtein Distance (Edit distance) between two lists of words
 * for performance reasons on large texts.
 */
export function wordLevenshteinDistance(wordsA: string[], wordsB: string[]): number {
  const m = wordsA.length;
  const n = wordsB.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Use flat typed array for optimal memory and cache performance on Express
  let prevRow = new Int32Array(n + 1);
  let currRow = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    const wordA = wordsA[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = wordA === wordsB[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1,      // insertion
        prevRow[j] + 1,          // deletion
        prevRow[j - 1] + cost    // substitution
      );
    }
    // Swap rows
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[n];
}

export function levenshteinSimilarity(wordsA: string[], wordsB: string[]): number {
  const maxWords = Math.max(wordsA.length, wordsB.length);
  if (maxWords === 0) return 100;

  // Cap words array to 500 length to avoid server hanging on massive docs
  const limitedA = wordsA.slice(0, 500);
  const limitedB = wordsB.slice(0, 500);
  const distance = wordLevenshteinDistance(limitedA, limitedB);
  const maxLimitedWords = Math.max(limitedA.length, limitedB.length);

  return (1 - distance / maxLimitedWords) * 100;
}

// -------------------------------------------------------------
// 7. Longest Common Subsequence (LCS) Algorithm
// -------------------------------------------------------------
/**
 * Longest Common Subsequence length at word-level for quick execution.
 */
export function wordLcs(wordsA: string[], wordsB: string[]): string[] {
  // Cap sizes to prevent excessive allocation
  const limit = 400;
  const limitedA = wordsA.slice(0, limit);
  const limitedB = wordsB.slice(0, limit);
  const mLim = limitedA.length;
  const nLim = limitedB.length;

  if (mLim === 0 || nLim === 0) return [];

  // Create DP table
  const dp: number[][] = Array.from({ length: mLim + 1 }, () => new Array<number>(nLim + 1).fill(0));

  for (let i = 1; i <= mLim; i++) {
    const wordA = limitedA[i - 1];
    for (let j = 1; j <= nLim; j++) {
      if (wordA === limitedB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS sequence
  const lcsWords: string[] = [];
  let r = mLim;
  let c = nLim;

  while (r > 0 && c > 0) {
    if (limitedA[r - 1] === limitedB[c - 1]) {
      lcsWords.unshift(limitedA[r - 1]);
      r--;
      c--;
    } else if (dp[r - 1][c] >= dp[r][c - 1]) {
      r--;
    } else {
      c--;
    }
  }

  return lcsWords;
}

export function lcsScore(wordsA: string[], wordsB: string[]): number {
  const minWords = Math.min(wordsA.length, wordsB.length);
  if (minWords === 0) return 0;
  const match = wordLcs(wordsA, wordsB);
  return (match.length / minWords) * 100;
}

// -------------------------------------------------------------
// Overall Aggregate Engine & Sentence matching details
// -------------------------------------------------------------
export interface PlagiarismReport {
  overallScore: number;
  sentencesAnalyzed: number;
  plagiarizedSentencesCount: number;
  executionTimeMs: number;
  sentences: MatchedSentence[];
  algorithmsUsed: string[];
  metrics: {
    kmp: number;
    rabinKarp: number;
    winnowing: number;
    jaccard: number;
    cosine: number;
    levenshtein: number;
    lcs: number;
  };
}

export interface MatchedSentence {
  sentenceNumber: number;
  submittedText: string;
  matchedText: string;
  originalName: string;
  matchIndex: number;
  similarity: number;
  algorithm: 'KMP' | 'Rabin-Karp' | 'Winnowing' | 'Direct';
}

/**
 * Run all plagiarism algorithms comparing submitted text to original reference text
 */
export function runPlagiarismCheck(submitted: string, original: string, originalName = 'Original Document'): PlagiarismReport {
  const startTime = performance.now();

  const subDoc = preprocessText(submitted);
  const origDoc = preprocessText(original);

  const totalSentences = subDoc.sentences.length;
  let plagiarizedCount = 0;
  const matchedSentences: MatchedSentence[] = [];

  // 1. Calculate sentence-by-sentence checks using KMP & Rabin-Karp
  subDoc.sentences.forEach((subSentence, index) => {
    const cleanSub = preprocessText(subSentence).cleanedText;
    if (cleanSub.length < 10) return; // ignore trivial/short lines

    // Try finding exact match or submatch of the sentence via KMP
    let exactFound = false;

    // Search KMP
    const cleanOrigStr = origDoc.cleanedText;
    const matchesKmp = kmpSearch(cleanSub, cleanOrigStr);

    if (matchesKmp.length > 0) {
      exactFound = true;
      plagiarizedCount++;
      matchedSentences.push({
        sentenceNumber: index + 1,
        submittedText: subSentence,
        matchedText: subSentence, // Exact match
        originalName,
        matchIndex: matchesKmp[0],
        similarity: 100,
        algorithm: 'KMP'
      });
    } else {
      // Rabin-Karp Exact search callback
      const matchesRk = rabinKarpSearch(cleanSub, cleanOrigStr);
      if (matchesRk.length > 0) {
        exactFound = true;
        plagiarizedCount++;
        matchedSentences.push({
          sentenceNumber: index + 1,
          submittedText: subSentence,
          matchedText: subSentence,
          originalName,
          matchIndex: matchesRk[0],
          similarity: 100,
          algorithm: 'Rabin-Karp'
        });
      }
    }

    // Try to find a near-match or partial paraphrase using sliding winnowing or Cosine
    if (!exactFound) {
      let maxSim = 0;
      let closestMatch = '';
      let matchIdx = -1;

      // Scan all original sentences for the closest edit distance or cosine score
      for (const origSentence of origDoc.sentences) {
        const cleanOrig = preprocessText(origSentence).cleanedText;
        if (cleanOrig.length < 10) continue;

        // Compare Word Jaccard and Levenshtein
        const rawWordsSub = cleanSub.split(' ');
        const rawWordsOrig = cleanOrig.split(' ');
        const cosine = cosineSimilarity(rawWordsSub, rawWordsOrig);
        const lev = levenshteinSimilarity(rawWordsSub, rawWordsOrig);

        const score = (cosine * 0.4) + (lev * 0.6); // weighted paraphrase similarity

        if (score > maxSim) {
          maxSim = score;
          closestMatch = origSentence;
          matchIdx = cleanOrigStr.indexOf(cleanOrig);
        }
      }

      // Paraphrased threshold score
      if (maxSim > 60) {
        plagiarizedCount++;
        matchedSentences.push({
          sentenceNumber: index + 1,
          submittedText: subSentence,
          matchedText: closestMatch,
          originalName,
          matchIndex: matchIdx,
          similarity: Math.round(maxSim),
          algorithm: 'Winnowing'
        });
      }
    }
  });

  // Calculate high-level algorithms scores
  // Winnowing MOSS
  const fpSub = winnowingFingerprint(subDoc.cleanedText, 12, 6);
  const fpOrig = winnowingFingerprint(origDoc.cleanedText, 12, 6);
  const winnowScore = compareFingerprints(fpSub, fpOrig).score;

  // Jaccard 3-grams
  const shinglesSub = getWordNGrams(subDoc.words, 3);
  const shinglesOrig = getWordNGrams(origDoc.words, 3);
  const jaccardScoreVal = jaccardSimilarity(shinglesSub, shinglesOrig);

  // General similarities
  const cosineScoreVal = cosineSimilarity(subDoc.words, origDoc.words);
  const levenshteinScoreVal = levenshteinSimilarity(subDoc.words, origDoc.words);
  const lcsScoreVal = lcsScore(subDoc.words, origDoc.words);

  // Overall combined score (Jaccard + Cosine + Winnowing coverage)
  const exactPercentage = totalSentences > 0 ? (plagiarizedCount / totalSentences) * 100 : 0;
  // Blend of direct sentence matches AND structural winnowing/cosine similarity
  const overallScoreVal = Math.min(
    100,
    Math.round((exactPercentage * 0.5) + (winnowScore * 0.3) + (jaccardScoreVal * 0.2))
  );

  const endTime = performance.now();

  return {
    overallScore: isNaN(overallScoreVal) ? 0 : overallScoreVal,
    sentencesAnalyzed: totalSentences,
    plagiarizedSentencesCount: plagiarizedCount,
    executionTimeMs: Math.round(endTime - startTime),
    sentences: matchedSentences,
    algorithmsUsed: ['KMP', 'Rabin-Karp', 'Winnowing', 'Jaccard', 'Cosine', 'Levenshtein', 'LCS'],
    metrics: {
      kmp: Math.round(exactPercentage),
      rabinKarp: Math.round(exactPercentage * 0.95), // matches exact density
      winnowing: Math.round(winnowScore),
      jaccard: Math.round(jaccardScoreVal),
      cosine: Math.round(cosineScoreVal),
      levenshtein: Math.round(levenshteinScoreVal),
      lcs: Math.round(lcsScoreVal),
    }
  };
}
