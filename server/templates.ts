export const chineseTemplate: Record<string, string> = {
  'main.tex': String.raw`\documentclass[UTF8,fontset=fandol,a4paper,12pt]{ctexart}
\usepackage[margin=2.6cm]{geometry}
\usepackage{amsmath,amssymb,graphicx,booktabs}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue]{hyperref}
\title{协作，让研究更进一步}
\author{研究小组}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
本文介绍一个支持实时协作与 PDF 预览的论文工作空间。我们从一个简单的问题出发：如何让写作更专注，让研究成果更清晰？
\end{abstract}
\tableofcontents
\input{sections/introduction}
\section{方法}
给定观测数据 $\{x_i\}_{i=1}^{n}$，我们通过最小化误差估计参数：
\begin{equation}\label{eq:loss}
  \mathcal{L}(\theta)=\frac{1}{n}\sum_{i=1}^{n}\bigl(y_i-f_\theta(x_i)\bigr)^2.
\end{equation}
公式~\ref{eq:loss} 展示了常见的均方误差目标。
\section{实验结果}
\begin{table}[h]
\centering
\caption{示例实验结果}
\begin{tabular}{lcc}\toprule
方法 & 准确率 & 耗时（秒） \\ \midrule
基线模型 & 0.86 & 12.4 \\
改进模型 & 0.93 & 8.7 \\ \bottomrule
\end{tabular}
\end{table}
\section{结论}
清晰的论证来自不断迭代。现在可以修改这份示例，或导入自己的论文模板。
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  'sections/introduction.tex': String.raw`\section{引言}\label{sec:intro}
科学研究是一段从问题出发、用证据回应的旅程。好的工具应当让研究者专注于内容，同时保持严谨的排版与可靠的协作。

LaTeX 将内容与呈现分离，尤其适合包含数学公式、参考文献和复杂章节结构的学术文档~\cite{lamport1994}。

可以邀请合作者同时编辑本段文字。停笔后，右侧预览会自动更新。
`,
  'references.bib': `@book{lamport1994,\n  author = {Leslie Lamport},\n  title = {LaTeX: A Document Preparation System},\n  publisher = {Addison-Wesley},\n  year = {1994},\n  edition = {2}\n}\n`,
};
export const englishTemplate: Record<string, string> = {
  'main.tex': String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,graphicx,booktabs}
\usepackage[colorlinks=true]{hyperref}
\title{A Shared Space for Research}
\author{Research Team}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
We present a collaborative workflow for writing, reviewing, and typesetting research. This template provides a starting point for an English-language paper.
\end{abstract}
\input{sections/introduction}
\section{Method}
Our objective is $\mathcal{L}(\theta)=\sum_i(y_i-f_\theta(x_i))^2$.
\section{Conclusion}
Replace this example with your own results.
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  'sections/introduction.tex': String.raw`\section{Introduction}
Clear writing makes complex ideas accessible. LaTeX offers a consistent foundation for academic publishing~\cite{lamport1994}.
`,
  'references.bib': chineseTemplate['references.bib'],
};
