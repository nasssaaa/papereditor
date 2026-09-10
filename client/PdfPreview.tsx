import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileText, Minus, Plus, Search, X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './pdf-text-layer.css';
import { apiUrl, assetUrl } from './api';
import { commandTitle, shortcutLabel } from './commands';
import type { Build } from '../shared/types';
GlobalWorkerOptions.workerSrc = workerUrl;
export interface PdfTarget {
  page: number;
  x: number;
  y: number;
  key: number;
}
export interface PdfHandle {
  focus(): void;
  search(): void;
  zoom(delta: number): void;
  fit(): void;
  download(): void;
}
function PdfPage({
  pdf,
  pageNumber,
  scale,
  onReverse,
  target,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onReverse: (page: number, x: number, y: number) => void;
  target: PdfTarget | null;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    textRoot = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber === 1),
    [size, setSize] = useState({ width: 595, height: 842 });
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      rootMargin: '1000px',
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    pdf
      .getPage(pageNumber)
      .then((p) => {
        if (active) {
          const v = p.getViewport({ scale: 1 });
          setSize({ width: v.width, height: v.height });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pdf, pageNumber]);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      renderTask:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
        | undefined,
      textLayer: TextLayer | undefined;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (!active) return;
      const viewport = page.getViewport({ scale }),
        ratio = Math.min(window.devicePixelRatio || 1, 2);
      const staging = document.createElement('canvas');
      staging.width = Math.ceil(viewport.width * ratio);
      staging.height = Math.ceil(viewport.height * ratio);
      renderTask = page.render({
        canvas: staging,
        canvasContext: staging.getContext('2d')!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
      if (!active || !canvas.current) return;
      canvas.current.width = staging.width;
      canvas.current.height = staging.height;
      canvas.current.getContext('2d')!.drawImage(staging, 0, 0);
      if (textRoot.current) {
        textRoot.current.innerHTML = '';
        textRoot.current.style.setProperty('--total-scale-factor', String(scale));
        textLayer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: textRoot.current,
          viewport,
        });
        await textLayer.render();
      }
    })().catch((e) => {
      if (e.name !== 'RenderingCancelledException' && active) console.warn('PDF page:', e.message);
    });
    return () => {
      active = false;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, scale, visible]);
  return (
    <div
      ref={root}
      className="pdf-page"
      data-page={pageNumber}
      style={{ width: size.width * scale, height: size.height * scale }}
      onDoubleClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onReverse(pageNumber, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
      }}
    >
      <canvas ref={canvas} />
      <div className="textLayer" ref={textRoot} />
      {target?.page === pageNumber && (
        <span
          key={target.key}
          className="pdf-location"
          style={{ left: target.x * scale, top: target.y * scale }}
        />
      )}
      <span className="page-number">{pageNumber}</span>
    </div>
  );
}
export function PdfPreview({
  build,
  busy,
  onCompile,
  onReverse,
  target,
  handle,
  onCommand,
  canCompile,
}: {
  build: Build | null;
  busy: boolean;
  onCompile: () => void;
  onReverse: (page: number, x: number, y: number) => void;
  target: PdfTarget | null;
  handle: React.MutableRefObject<PdfHandle | null>;
  onCommand: (id: string) => void;
  canCompile: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(''),
    [zoom, setZoom] = useState<number | null>(null),
    [width, setWidth] = useState(600),
    [showSearch, setShowSearch] = useState(false),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<number[]>([]),
    [hitIndex, setHitIndex] = useState(0),
    [searching, setSearching] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const scale = zoom || Math.min(1.4, Math.max(0.3, (width - 48) / 595));
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    handle.current = {
      focus: () => scroll.current?.focus({ preventScroll: true }),
      search: () => {
        setShowSearch(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      },
      zoom: (delta) => setZoom(Math.min(2.5, Math.max(0.25, scale + delta))),
      fit: () => setZoom(null),
      download: () => {
        if (!build) return;
        const link = document.createElement('a');
        link.href = apiUrl(`/builds/${build.id}/pdf`);
        link.download = 'paper.pdf';
        link.click();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [scale, build?.id]);
  const closeSearch = () => {
    setShowSearch(false);
    scroll.current?.focus({ preventScroll: true });
  };
  const nextHit = (direction: number) => {
    if (!hits.length) return;
    const index = (hitIndex + direction + hits.length) % hits.length;
    setHitIndex(index);
    toPage(hits[index]);
  };
  useEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!build) return;
    let active = true;
    const task = getDocument({
      url: apiUrl(`/builds/${build.id}/pdf`),
      enableXfa: false,
      cMapUrl: assetUrl('pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
      wasmUrl: assetUrl('pdfjs/wasm/'),
      iccUrl: assetUrl('pdfjs/iccs/'),
    });
    task.promise
      .then((p) => {
        if (active) {
          setPdf(p);
          setError('');
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e.status === 204
              ? '收到空的 PDF 响应。可能被 IDM 等下载工具拦截，请将本站加入下载工具的忽略列表后刷新页面。'
              : e.message,
          );
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [build?.id]);
  const toPage = (page: number) => {
    const element = scroll.current?.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (element && scroll.current)
      scroll.current.scrollTo({ top: element.offsetTop - 24, behavior: 'smooth' });
  };
  useEffect(() => {
    if (target) {
      toPage(target.page);
      setTimeout(() => {
        const e = scroll.current?.querySelector(
          `[data-page="${target.page}"]`,
        ) as HTMLElement | null;
        if (e && scroll.current)
          scroll.current.scrollTo({
            top: Math.max(0, e.offsetTop + target.y * scale - scroll.current.clientHeight / 3),
            behavior: 'smooth',
          });
      }, 100);
    }
  }, [target]);
  useEffect(() => {
    if (!pdf || !query) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        const found: number[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const page = await pdf.getPage(p),
            content = await page.getTextContent();
          const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
          if (text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push(p);
        }
        if (!cancelled) {
          setHits(found);
          setHitIndex(0);
          setSearching(false);
          if (found.length) toPage(found[0]);
        }
      })().catch(() => {
        if (!cancelled) setSearching(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, pdf]);
  return (
    <section
      className="preview-panel"
      aria-label="PDF 预览"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('button,input,a'))
          scroll.current?.focus({ preventScroll: true });
      }}
    >
      <div className="preview-toolbar">
        <span className="pane-title">
          <FileText size={15} /> PDF 预览
        </span>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title={commandTitle('find')}
            aria-label="搜索 PDF"
            onClick={() => onCommand('pdfSearch')}
            disabled={!build}
          >
            <Search size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            title="缩小"
            aria-label="缩小"
            onClick={() => onCommand('pdfZoomOut')}
            disabled={!build}
          >
            <Minus size={16} />
          </button>
          <button
            className="zoom-value"
            title="点击适应宽度"
            onClick={() => onCommand('pdfFit')}
            disabled={!build}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            className="icon-button"
            title="放大"
            aria-label="放大"
            onClick={() => onCommand('pdfZoomIn')}
            disabled={!build}
          >
            <Plus size={16} />
          </button>
          {build && (
            <a
              className="icon-button"
              title="下载 PDF"
              aria-label="下载 PDF"
              href={apiUrl(`/builds/${build.id}/pdf`)}
              download="paper.pdf"
              onClick={(e) => {
                e.preventDefault();
                onCommand('pdfDownload');
              }}
            >
              <Download size={16} />
            </a>
          )}
        </div>
      </div>
      {showSearch && (
        <div
          className="pdf-search"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeSearch();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              nextHit(e.shiftKey ? -1 : 1);
            }
          }}
        >
          <input
            ref={searchInput}
            autoFocus
            aria-label="PDF 搜索词"
            placeholder="搜索 PDF 正文"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>{searching ? '搜索中' : hits.length ? `${hitIndex + 1}/${hits.length}` : '0'}</span>
          <button
            className="icon-button"
            aria-label="上一个结果"
            disabled={!hits.length}
            onClick={() => nextHit(-1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="下一个结果"
            disabled={!hits.length}
            onClick={() => nextHit(1)}
          >
            <ChevronDown size={15} />
          </button>
          <button className="icon-button" aria-label="关闭搜索" onClick={closeSearch}>
            <X size={15} />
          </button>
        </div>
      )}
      <div
        className="pdf-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="PDF 正文"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && showSearch && !e.nativeEvent.isComposing) {
            e.preventDefault();
            closeSearch();
          }
        }}
      >
        {pdf ? (
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage
              key={i + 1}
              pdf={pdf}
              pageNumber={i + 1}
              scale={scale}
              onReverse={onReverse}
              target={target}
            />
          ))
        ) : (
          <div className="preview-empty">
            <div className="empty-paper">
              <FileText size={38} strokeWidth={1} />
            </div>
            <h2>{busy ? '正在排版你的论文' : '让想法成为论文'}</h2>
            <p>
              {busy ? '编译完成后，PDF 会显示在这里。' : '选择主文件并编译，即可查看排版结果。'}
            </p>
            <button
              className="primary-button"
              onClick={onCompile}
              disabled={busy || !canCompile}
              title={commandTitle('save')}
            >
              {busy ? '编译中…' : '编译论文'}
              <kbd>{shortcutLabel('save')}</kbd>
            </button>
          </div>
        )}
        {error && <div className="inline-error">PDF 加载失败：{error}</div>}
      </div>
      <div className="preview-footer">
        <span>{pdf ? `${pdf.numPages} 页` : '等待首次编译'}</span>
        <span>双击正文定位源码</span>
        {build && <span>版本 {build.revision}</span>}
      </div>
    </section>
  );
}
