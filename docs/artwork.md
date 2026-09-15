# ゲーム画像の生成記録

現在の苗の葉はSVGによる手続き描画です。`assets/leaf-sprites.png` と `assets/game-sprites.png` 内の苗画像（0〜4番）は使用していません。以下は素材生成時の履歴として保持しています。実・花・つぼみには引き続き `assets/game-sprites.png` の5〜11番を使用します。

## 葉の追加素材（自然な個体差のため）

- 保存先: `assets/leaf-sprites.png`
- 使用手段: 組み込み `imagegen`、1回生成、再生成・画像編集なし。
- 1254 × 1254 px、RGBA、2列 × 2行。正面・左向き・右向き・巻いた葉の順。
- 生成結果には複数の葉身を含む素材もあるため、小さな葉のまとまりとして使用。角度・大きさ・接続位置を個別に変え、株ごとの形を組み立てる。
- 各セルの茎の先端位置（左上を0%）: `(52.55%, 87.88%)`、`(71.14%, 87.88%)`、`(39.31%, 86.44%)`、`(59.30%, 85.81%)`。目視と透明度の読み取りで確認。

### 葉の生成プロンプト

```text
Use case: illustration-story
Asset type: new 2D game sprite atlas of four individual strawberry leaf blades for procedural arrangement in a children's strawberry farm game.
Reference image role: STYLE REFERENCE ONLY. Match its bright green strawberry foliage, crisp softly painted children's illustration shapes and visible veins. Create a new atlas; do not modify, copy the composition of, or reproduce the old atlas.
Primary request: exactly ONE square 1024x1024 RGBA PNG atlas with a genuinely transparent alpha background, divided invisibly into EXACTLY TWO equal columns and TWO equal rows. Exactly FOUR sprites total, ONE individual strawberry leaf blade in each cell. No visible grid.
Layout: invisible 512x512 cells, centers at (256,256), (768,256), (256,768), (768,768). Each leaf including its short petiole must stay within the central 65% of its cell, leaving substantial fully transparent padding on all sides. Keep the four leaf sprites at comparable sizes and centered. No artwork crossing cell borders.
Precise row-major order:
Cell 0, top left: one front-facing natural strawberry leaf blade, slightly asymmetric, with a broad rounded serrated outline.
Cell 1, top right: one strawberry leaf blade viewed at a three-quarter angle turned left, a naturally narrower projected shape.
Cell 2, bottom left: one strawberry leaf blade viewed at a three-quarter angle turned right, its own distinct natural outline, NOT a mirrored clone of cell 1.
Cell 3, bottom right: one slightly curled strawberry leaf blade, with a modest curl visible along one edge.
Every cell contains ONLY ONE leaf blade, not a trifoliate leaf, not a leaf group, not a plant. Each individual blade has recognizable strawberry-like serrated edges, clear natural veins, a generally upward-pointing tip, and a SHORT green petiole connecting at the bottom and pointing down. Mildly different green tones, organic shapes, vein patterns and asymmetric silhouettes make the four leaves feel naturally varied. Soft rounded forms, crisp clean outlines readable small, cheerful bright green hues, consistent style, no faces.
Transparency: real alpha=0 background and empty padding, NOT a black, white, colored or checkerboard backdrop. Clean cutout edges with no background residue, halo or stray pixels.
Avoid: full plants, leaf clusters, multiple blades in one cell, fruits, flowers, pots, soil, roots, backgrounds, ground, cast shadows, labels, text, numbers, borders, grid lines and watermarks. Exactly four separate individual leaf blades only.
```

## 苗・イチゴの初期素材

- 使用手段: 組み込み `imagegen`。CLI / API フォールバックは不使用。
- 保存先: `assets/game-sprites.png`
- 実ファイル: 1254 × 1254 px、RGBA PNG、810,754 bytes。
- 4列 × 4行のスプライトシート。0〜4番は苗の1〜5段階、5〜11番はつぼみ・花・白・薄ピンク・赤・濃赤・腐敗。最終行は未使用。
- 1回生成し、目視と透明度の読み取り検査を実施。再生成・画像編集なし。
- 検査結果: 12枚の絵の並びと各セル内への収まりを確認。苗の葉数は指示どおりの厳密な枚数ではないが、大きさと茂り方で成長段階を表す。未使用領域にごく薄い画素が少数あるため、完全な無画素領域として扱わない。

## 最終プロンプト

```text
Use case: illustration-story
Asset type: production 2D sprite atlas for a children's strawberry growing game.
Create exactly ONE square 1024x1024 RGBA PNG sprite sheet with a GENUINELY TRANSPARENT background (alpha=0 outside the artwork; do not draw a checkerboard or a colored backdrop). The atlas has exactly FOUR equal columns and FOUR equal rows, sixteen invisible 256x256 cells. Do not draw the grid. Coordinates are precise: columns centered at x=128,384,640,896; rows centered at y=128,384,640,896. Each sprite stays comfortably inside its own cell with generous transparent padding, centered around that cell center. All art in the first THREE rows. The entire FOURTH row is completely transparent and empty.
Style: cute simple clear 2D children's strawberry farm illustrations, vibrant green leaves and red fruit, softly rounded forms with crisp clean shapes readable at small size. Consistent front view, consistent style throughout. No faces.
Exact row-major ordering:
ROW 1, column 1 (cell 0): stage-1 seedling, tiny sprout with exactly TWO green leaves.
ROW 1, column 2 (cell 1): stage-2 small strawberry plant with exactly THREE green leaves.
ROW 1, column 3 (cell 2): stage-3 medium strawberry plant with exactly FIVE green leaves.
ROW 1, column 4 (cell 3): stage-4 larger strawberry plant with exactly SEVEN green leaves.
ROW 2, column 1 (cell 4): stage-5 lush large strawberry plant with exactly NINE green leaves.
These five plants have ONLY green leaves and very short green stems; NO fruit, NO flowers, NO buds, NO pots, NO soil, NO roots, NO ground, NO shadows.
ROW 2, column 2 (cell 5): ONE separate small closed flower bud.
ROW 2, column 3 (cell 6): ONE separate white five-petal strawberry flower with a yellow center.
ROW 2, column 4 (cell 7): ONE separate white unripe strawberry with a green calyx.
ROW 3, column 1 (cell 8): ONE separate pale pink strawberry with a green calyx.
ROW 3, column 2 (cell 9): ONE separate bright red ripe strawberry with a green calyx.
ROW 3, column 3 (cell 10): ONE separate dark red ripe strawberry with a green calyx.
ROW 3, column 4 (cell 11): ONE separate spoiled brown-gray strawberry with a wilted calyx.
ROW 4, all four cells 12,13,14,15: completely empty, transparent alpha=0. NO artwork whatsoever.
Constraints: EXACTLY 12 sprites in the specified 16-cell atlas; no objects crossing cell boundaries; no extra objects; no labels, numerals, text, watermark, decorative borders, grid lines, scene, background, ground or cast shadows. Respect empty fourth row even though it creates a large blank transparent area.
```
