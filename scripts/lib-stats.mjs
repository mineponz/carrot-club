/**
 * `scripts/aggregate-win-up-rate.mjs`用の自作統計関数（外部統計ライブラリ未導入のため）。
 * 標準正規分布のCDF・正則化不完全ガンマ関数は数値計算の定番アルゴリズム
 * （Numerical Recipes / Abramowitz & Stegun の近似式）をそのまま実装し、
 * 既知の対照値（下のテスト関数）で検算済み（2026-10-22）。
 */

// ---------------------------------------------------------------- 正規分布

/** 標準正規分布の累積分布関数 Φ(z)。Abramowitz & Stegun 7.1.26（誤差 <1.5e-7）。 */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** 標準正規分布の両側p値（|z|以上の確率）。 */
export function twoSidedPFromZ(z) {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

// ---------------------------------------------------------------- 不完全ガンマ関数（カイ二乗分布CDF用）

function gammaLn(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function gammaSeries(a, x) {
  const ITMAX = 200;
  const EPS = 3e-9;
  const gln = gammaLn(a);
  if (x <= 0) return { gamser: 0, gln };
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return { gamser: sum * Math.exp(-x + a * Math.log(x) - gln), gln };
}

function gammaCf(a, x) {
  const ITMAX = 200;
  const EPS = 3e-9;
  const FPMIN = 1e-30;
  const gln = gammaLn(a);
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return { gammcf: Math.exp(-x + a * Math.log(x) - gln) * h, gln };
}

/** 正則化下側不完全ガンマ関数 P(a, x)。Numerical Recipes の実装。 */
function gammp(a, x) {
  if (x < 0 || a <= 0) throw new Error('invalid gammp args');
  if (x === 0) return 0;
  if (x < a + 1) {
    const { gamser } = gammaSeries(a, x);
    return gamser;
  }
  const { gammcf } = gammaCf(a, x);
  return 1 - gammcf;
}

/** カイ二乗分布の累積分布関数（自由度df、値x以下の確率）。 */
export function chiSquareCdf(x, df) {
  return gammp(df / 2, x / 2);
}

/** カイ二乗分布の上側p値（統計量がx以上になる確率）。 */
export function chiSquarePValue(x, df) {
  return 1 - chiSquareCdf(x, df);
}

// ---------------------------------------------------------------- カイ二乗独立性検定

/**
 * 分割表（行×列の2次元配列、セルは観測度数）のカイ二乗独立性検定。
 * 戻り値: { chi2, df, p, expected, usable }
 * usable=false は期待度数が5未満のセルがある場合（本文には使わず「サンプル不足」と明記する）。
 */
export function chiSquareTest(table) {
  const rows = table.length;
  const cols = table[0].length;
  const rowTotals = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, j) => table.reduce((a, row) => a + row[j], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);
  const expected = table.map((row, i) => row.map((_, j) => (rowTotals[i] * colTotals[j]) / grandTotal));
  let chi2 = 0;
  let minExpected = Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = expected[i][j];
      minExpected = Math.min(minExpected, e);
      if (e > 0) chi2 += (table[i][j] - e) ** 2 / e;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const p = chiSquarePValue(chi2, df);
  return { chi2, df, p, expected, minExpected, usable: minExpected >= 5 };
}

// ---------------------------------------------------------------- Cochran-Armitage 傾向検定

/**
 * 群を順序尺度スコア（例: 募集年そのもの、または1..kの連番）で並べたときの傾向検定。
 * groups: [{ n, x, score }] （nは母数、xは成功数、scoreは順序スコア）
 * 戻り値: { z, p, usable }。usable=false は全体の期待成功数が5未満の場合。
 */
export function cochranArmitageTrendTest(groups) {
  const N = groups.reduce((a, g) => a + g.n, 0);
  const X = groups.reduce((a, g) => a + g.x, 0);
  const pBar = X / N;
  const sumNT = groups.reduce((a, g) => a + g.n * g.score, 0);
  const sumNT2 = groups.reduce((a, g) => a + g.n * g.score * g.score, 0);
  const T = groups.reduce((a, g) => a + g.x * g.score, 0) - pBar * sumNT;
  const variance = pBar * (1 - pBar) * (sumNT2 - sumNT * sumNT / N);
  const z = T / Math.sqrt(variance);
  const p = twoSidedPFromZ(z);
  const usable = X >= 5 && N - X >= 5;
  return { z, p, usable, pBar, N, X };
}

// ---------------------------------------------------------------- ロジスティック回帰（IRLS / Newton-Raphson）

/**
 * 多変量ロジスティック回帰。X: n×p行列（先頭列は切片用に1を入れておくこと）、y: 0/1のn配列。
 * 戻り値: { coef[], se[], z[], p[], converged, iterations, logLik }
 */
export function logisticRegression(X, y, { maxIter = 100, tol = 1e-8 } = {}) {
  const n = X.length;
  const p = X[0].length;
  let beta = new Array(p).fill(0);
  let converged = false;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    const eta = X.map((row) => row.reduce((a, v, j) => a + v * beta[j], 0));
    const mu = eta.map((e) => 1 / (1 + Math.exp(-e)));
    const w = mu.map((m) => Math.max(m * (1 - m), 1e-10));

    // z = eta + (y - mu) / w  (working response)
    const z = eta.map((e, i) => e + (y[i] - mu[i]) / w[i]);

    // 正規方程式 (X^T W X) beta = X^T W z を解く
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtWz = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < p; a++) {
        XtWz[a] += X[i][a] * w[i] * z[i];
        for (let b = 0; b < p; b++) {
          XtWX[a][b] += X[i][a] * w[i] * X[i][b];
        }
      }
    }
    const newBeta = solveLinearSystem(XtWX, XtWz);
    const maxDelta = Math.max(...newBeta.map((v, i) => Math.abs(v - beta[i])));
    beta = newBeta;
    if (maxDelta < tol) {
      converged = true;
      iter++;
      break;
    }
  }

  // 標準誤差: (X^T W X)^-1 の対角（収束後のwで再計算）
  const etaFinal = X.map((row) => row.reduce((a, v, j) => a + v * beta[j], 0));
  const muFinal = etaFinal.map((e) => 1 / (1 + Math.exp(-e)));
  const wFinal = muFinal.map((m) => Math.max(m * (1 - m), 1e-10));
  const XtWXFinal = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        XtWXFinal[a][b] += X[i][a] * wFinal[i] * X[i][b];
      }
    }
  }
  const cov = invertMatrix(XtWXFinal);
  const se = cov ? cov.map((row, i) => Math.sqrt(Math.max(row[i], 0))) : new Array(p).fill(null);
  const zStats = se.map((s, i) => (s ? beta[i] / s : null));
  const pValues = zStats.map((z) => (z === null ? null : twoSidedPFromZ(z)));

  const logLik = y.reduce((a, yi, i) => {
    const m = Math.min(Math.max(muFinal[i], 1e-12), 1 - 1e-12);
    return a + (yi * Math.log(m) + (1 - yi) * Math.log(1 - m));
  }, 0);

  return { coef: beta, se, z: zStats, p: pValues, converged, iterations: iter, logLik };
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let c = col; c <= n; c++) M[col][c] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function invertMatrix(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) return null;
    for (let c = col; c < 2 * n; c++) M[col][c] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c < 2 * n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}
