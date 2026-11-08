// ============================================================
// rules.js（自動で作ったファイル。直接書き換えないでください）
// 元：src/game/rules/index.ts（npm run build:rules で作り直す）
// エディタとゲームが同じ「計算の決まり」を使うためのファイル。グローバル変数 GameRules になる。
// ============================================================
var GameRules = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// src/game/rules/index.ts
	/** 1px を何単位で表すか */
	var SUB = 1e3;
	/** 項目が無いときの初期値（エディタの入力欄の初期値もこれを使う） */
	var DEFAULTS = {
		walkForward: 4,
		walkBack: 3,
		stepWindow: 12,
		hitPush: 40,
		guardPush: 60,
		pushFrames: 8,
		chainMax: 3,
		hitstop: 10,
		spawnX: 150,
		spawnY: 190,
		hitInterval: 6,
		nearGap: 40,
		jump: {
			pre: 4,
			air: 38,
			land: 3,
			height: 450,
			forwardDist: 320
		}
	};
	/** 整数の割り算（0の方向へ切り捨て） */
	function idiv(a, b) {
		return Math.trunc(a / b);
	}
	/** total を n 回に分けたときの i 回目（0始まり）。n 回分を足すと必ず total */
	function spread(total, n, i) {
		return idiv(total * (i + 1), n) - idiv(total * i, n);
	}
	/** コマの表示フレーム数（最低1） */
	function dur(f) {
		return Math.max(1, f.dur | 0);
	}
	/** 技の全体フレーム数 */
	function totalFrames(m) {
		return m.frames.reduce((s, f) => s + dur(f), 0);
	}
	/** g フレーム目（0始まり）が何コマ目か（0始まり） */
	function frameIndexAt(m, g) {
		let t = 0;
		for (let i = 0; i < m.frames.length; i++) {
			t += dur(m.frames[i]);
			if (g < t) return i;
		}
		return Math.max(0, m.frames.length - 1);
	}
	/** i コマ目（0始まり）が始まるフレーム（0始まり） */
	function frameStart(m, i) {
		let t = 0;
		for (let k = 0; k < i; k++) t += dur(m.frames[k]);
		return t;
	}
	/** 攻撃判定か投げ判定のあるコマか */
	function isActive(f) {
		return !!f && !!(f.hit && f.hit.length || f.throw && f.throw.length);
	}
	/**
	* 段（1ヒット）の一覧。攻撃判定のあるコマが続いている間は同じ段。
	* 攻撃判定のないコマを挟むか、コマの newHit（エディタの「次の段」）で次の段になる。
	* from / to はコマ番号（0始まり）、g0 はその段が始まるフレーム（0始まり）。
	*/
	function hitGroups(m) {
		const out = [];
		let t = 0;
		let cur = null;
		m.frames.forEach((f, i) => {
			if (isActive(f)) {
				if (!cur || f.newHit) {
					cur = {
						from: i,
						to: i,
						g0: t
					};
					out.push(cur);
				} else cur.to = i;
			} else cur = null;
			t += dur(f);
		});
		return out;
	}
	/**
	* 発生・持続・硬直（数え方の決まり）
	*   発生 st：最初に攻撃判定が出るフレーム（当たるフレームを含めて数える。発生5F＝5F目に当たる）
	*   持続 ac：最初の攻撃判定から最後の攻撃判定まで
	*   硬直 rc：最後の攻撃判定の後から、技の終わりまで
	* first / lastA は 0 始まりのフレーム番号。攻撃判定が無ければ st は null。
	*/
	function calcFrames(m) {
		const tot = totalFrames(m);
		let first = -1;
		let lastA = -1;
		for (let g = 0; g < tot; g++) if (isActive(m.frames[frameIndexAt(m, g)])) {
			if (first < 0) first = g;
			lastA = g;
		}
		if (first < 0) return {
			tot,
			st: null,
			ac: 0,
			rc: 0,
			first: -1,
			lastA: -1
		};
		return {
			tot,
			st: first + 1,
			ac: lastA - first + 1,
			rc: tot - lastA - 1,
			first,
			lastA
		};
	}
	/**
	* 有利フレーム ＝ 相手の硬直 −（その段が当たった後に、自分が動けない残りフレーム）
	* ヒットストップは両者止まるので入れない。hitStart はその段の発生（1始まり）。
	*/
	function advantage(tot, hitStart, stun) {
		return stun - (tot - hitStart);
	}
	/** 後ろへ動く技か（44・後ろ移動。dist は「距離」なので向きをここで決める） */
	function isBackwardMove(id, m) {
		return m.cmd?.dir === "44" || m.command === "44" || id.endsWith("_back");
	}
	/**
	* 技中の移動を、1フレームごとの量（SUB）にする。
	*   dx：前がプラス。コマの mx を表示フレーム数で均等に割る（mx の無い移動技は dist を全体に均等に）
	*   dy：上がプラス。コマの my を表示フレーム数で均等に割る
	*/
	function frameMoves(id, m) {
		const total = totalFrames(m);
		const distSub = !m.frames.some((f) => f.mx) && m.dist ? Math.round(m.dist * SUB) * (isBackwardMove(id, m) ? -1 : 1) : 0;
		const dx = [];
		const dy = [];
		let g = 0;
		for (const f of m.frames) {
			const d = dur(f);
			const mx = Math.round((f.mx || 0) * SUB);
			const my = Math.round((f.my || 0) * SUB);
			for (let j = 0; j < d; j++) {
				dx.push(distSub ? spread(distSub, total, g) : spread(mx, d, j));
				dy.push(spread(my, d, j));
				g++;
			}
		}
		return {
			dx,
			dy
		};
	}
	/** g フレーム目（0始まり）までに進んだ距離・上がった高さの合計（SUB、g フレーム目の分も含む） */
	function movedAt(id, m, g) {
		const { dx, dy } = frameMoves(id, m);
		let x = 0;
		let y = 0;
		for (let k = 0; k <= g && k < dx.length; k++) {
			x += dx[k];
			y += dy[k];
		}
		return {
			x,
			y
		};
	}
	/**
	* 段ごとの値。1段目（i=0）は技そのものの値、2段目以降は hits[i] にあればその値、無ければ1段目の値。
	* 項目が無ければ undefined（初期値は呼ぶ側で決める）。
	*/
	function hitValue(m, i, k) {
		const o = i > 0 && m.hits ? m.hits[i] : void 0;
		if (o && o[k] !== void 0) return o[k];
		return m[k];
	}
	/**
	* 押し返しの k フレーム目（0始まり）までに進んだ合計。
	* 最初が速く、だんだん遅くなる（重み N, N-1, …, 1）。合計は必ず total ぴったり。
	*/
	function pushProgress(total, n, k) {
		if (k < 0) return 0;
		if (k >= n - 1) return total;
		const S = n * (n + 1) / 2;
		return idiv(total * ((k + 1) * n - k * (k + 1) / 2), S);
	}
	/**
	* 踏み切ってから t フレーム目の高さ（SUB）。
	* 高さ ＝ 4 × 最高点 × t × (A − t) ÷ A²（A ＝ 滞空 + 1。t = A/2 で最高点、t = A で着地）
	*/
	function jumpY(j, t) {
		const A = j.air + 1;
		return idiv(4 * j.height * t * (A - t), A * A);
	}
	/** 高さ y から落ち始めるときの「踏み切ってからのフレーム」（落ちる側。最高点より上なら最高点） */
	function fallStartT(j, y) {
		const A = j.air + 1;
		let tt = Math.ceil(A / 2);
		while (tt < A && jumpY(j, tt) > y) tt++;
		return tt;
	}
	/** システム設定から決まりを作る（小数の倍率は、ここで整数の％にする） */
	function rulesFromSystem(sys) {
		return {
			counterHitstun: sys?.counterHit?.hitstunBonus ?? 3,
			counterHitstop: sys?.counterHit?.hitstopBonus ?? 5,
			counterDamagePct: Math.round((sys?.counterHit?.damageRate ?? 1.2) * 100),
			counterText: sys?.counterHit?.showText ?? "COUNTER",
			perMovePct: Math.round((sys?.comboScaling?.perMove ?? .1) * 100),
			minPct: Math.round((sys?.comboScaling?.minRate ?? .5) * 100)
		};
	}
	/** コンボの n 個目（0始まり）の技の補正（％）。技単位で数える（多段技も1つ） */
	function scalePct(r, n) {
		return Math.max(r.minPct, 100 - r.perMovePct * n);
	}
	/** ダメージ ＝ 技のダメージ ×（溜めの％）× コンボ補正 ×（カウンターなら倍率）。端数は切り捨て */
	function calcDamage(r, base, holdPct, n, counter) {
		return idiv(base * holdPct * scalePct(r, n) * (counter ? r.counterDamagePct : 100), 1e6);
	}
	/** 溜めで、待った時間 waited で届いている段階（0始まり。届いていなければ -1） */
	function holdLevelAt(levels, waited) {
		let lv = -1;
		[...levels || []].sort((a, b) => (a.at | 0) - (b.at | 0)).forEach((l, i) => {
			if (waited >= (l.at | 0)) lv = i;
		});
		return lv;
	}
	/**
	* 文字のコマンド（"2+P" "方向+S（仮）" "P（近距離）" "空中K" "66" "月回転中にP" など）を、
	* 選ぶ形（cmd）に変える。cmd の無い古いデータは、ゲームもエディタもこれで読む。
	*/
	function cmdFromText(text, cat) {
		const raw = (text || "").trim();
		const note = (raw.match(/（([^）]*)）/) || [])[1] || "";
		let base = raw.replace(/（[^）]*）/g, "").trim();
		const c = {
			use: "normal",
			dir: "any",
			buttons: "",
			air: false,
			range: ""
		};
		if (cat === "projectile" || !base || /つかまれ/.test(raw)) {
			c.use = "none";
			return c;
		}
		if (/ガード硬直中/.test(raw)) c.use = "guard";
		else if (/ヒット時|中に/.test(raw)) c.use = "followup";
		base = base.replace(/^.*中に/, "").replace(/^ガード硬直中に?/, "");
		if (base.startsWith("空中")) {
			c.air = true;
			base = base.slice(2);
		}
		if (base === "66" || base === "44") {
			c.dir = base;
			return c;
		}
		const tk = base.split("+").map((x) => x.trim()).filter(Boolean);
		const normalStand = cat === "normal" && !c.air;
		if (tk[0] === "方向") c.dir = "any";
		else if (/^[1-9]$/.test(tk[0] || "")) c.dir = tk[0] === "2" && cat === "normal" ? "down" : tk[0];
		else c.dir = normalStand ? "stand" : "any";
		c.buttons = [
			"P",
			"K",
			"S"
		].filter((b) => tk.includes(b)).join("+");
		if (!c.buttons) c.use = "none";
		c.range = /近距離/.test(note) ? "near" : /遠距離/.test(note) ? "far" : "";
		if (cat === "motion" && c.use !== "none") c.use = "none";
		return c;
	}
	/** 技のコマンド（cmd があればそれ、無ければ文字から作る） */
	function commandOf(m) {
		return m.cmd ?? cmdFromText(m.command || "", m.category || "motion");
	}
	exports.DEFAULTS = DEFAULTS;
	exports.SUB = SUB;
	exports.advantage = advantage;
	exports.calcDamage = calcDamage;
	exports.calcFrames = calcFrames;
	exports.cmdFromText = cmdFromText;
	exports.commandOf = commandOf;
	exports.dur = dur;
	exports.fallStartT = fallStartT;
	exports.frameIndexAt = frameIndexAt;
	exports.frameMoves = frameMoves;
	exports.frameStart = frameStart;
	exports.hitGroups = hitGroups;
	exports.hitValue = hitValue;
	exports.holdLevelAt = holdLevelAt;
	exports.isActive = isActive;
	exports.isBackwardMove = isBackwardMove;
	exports.jumpY = jumpY;
	exports.movedAt = movedAt;
	exports.pushProgress = pushProgress;
	exports.rulesFromSystem = rulesFromSystem;
	exports.scalePct = scalePct;
	exports.totalFrames = totalFrames;
	return exports;
})({});
