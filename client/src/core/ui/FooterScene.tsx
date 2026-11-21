import { useEffect, useRef, useState } from 'react';
import { useThemeOptIn } from './useThemeOptIn';
import './footer-scene.css';

/**
 * The footer's winter scene (the Yule world): a snowbank that fills the
 * footer, with drifts heaped along its top, snowy pines at either end, and
 * Santa's sleigh riding by now and then. Drawn in a theme that turns it on
 * with `--footer-scene-alpha`, and in colours taken from the theme
 * (footer-scene.css), never hard-coded.
 *
 * It takes only space every page already has: the 48 px `.shell-main` leaves
 * empty above the footer (its bottom padding) and the footer's own band,
 * which the bank fills behind the footer's text. No page grows and nothing
 * moves, so the editors sized to the window keep their size. Behind the
 * content, no pointer events, hidden from assistive tech. The ride runs only while the
 * footer is on screen, so Santa comes by soon after you reach the bottom of a
 * page and nothing animates otherwise. Phones hide the footer, and with it
 * the scene.
 */
export function FooterScene() {
  const level = useThemeOptIn('--footer-scene-alpha');
  const scene = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = scene.current;
    if (!element) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      // No way to tell, so let it ride: one compositor animation.
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [level]);

  if (level === 0) return null;
  return (
    <div
      ref={scene}
      className={inView ? 'footer-scene footer-scene--riding' : 'footer-scene'}
      aria-hidden="true"
    >
      <div className="footer-scene__band">
        {/* Back to front: a bluish back drift for depth, the pines, then the
            front drift with a rim along its top. Heaped at both ends, where
            the pines stand, and low in the middle, where the sleigh rides. */}
        <svg className="footer-scene__drifts" viewBox="0 0 1200 26" preserveAspectRatio="none">
          <path
            className="fs-drift-back"
            d="M0 26L0 9Q70 6 150 12Q240 19 340 17Q460 14 570 18Q690 22 810 16Q920 11 1000 15Q1060 18 1110 11Q1160 5 1200 8L1200 26Z"
          />
        </svg>
        <svg className="footer-scene__trees footer-scene__trees--left" viewBox="0 0 104 48">
          <Pine x={19} h={33} decorated />
          <Pine x={45} h={27} />
          <Pine x={68} h={21} />
          <Pine x={88} h={16} base={40} />
        </svg>
        <svg className="footer-scene__trees footer-scene__trees--right" viewBox="0 0 104 48">
          <Pine x={16} h={17} base={41} />
          <Pine x={36} h={23} base={40} />
          <Pine x={60} h={33} decorated />
          <Pine x={85} h={27} />
        </svg>
        <svg className="footer-scene__drifts" viewBox="0 0 1200 26" preserveAspectRatio="none">
          <path
            className="fs-snow"
            d="M0 26L0 12Q50 9 110 13Q180 19 290 22Q430 23 560 24Q700 25 830 23Q950 21 1010 20Q1070 15 1120 13Q1170 11 1200 12L1200 26Z"
          />
          <path
            className="fs-rim"
            d="M0 12Q50 9 110 13Q180 19 290 22Q430 23 560 24Q700 25 830 23Q950 21 1010 20Q1070 15 1120 13Q1170 11 1200 12"
          />
        </svg>
        <div className="footer-scene__ride">
          <svg className="footer-scene__sleigh" viewBox="0 0 224 40">
            <Sleigh />
            {[66, 106, 146, 186].map((x, i) => (
              <Reindeer key={x} x={x} stride={i % 2 === 0} />
            ))}
          </svg>
        </div>
      </div>
      <div className="footer-scene__bank" />
    </div>
  );
}

/** A snowy pine planted in a drift (its foot at `base`, y 38 by default), three tiers. */
function Pine({
  x,
  h,
  base = 38,
  decorated = false,
}: {
  x: number;
  h: number;
  base?: number;
  decorated?: boolean;
}) {
  const top = base - h;
  const width = h * 0.62;
  const tiers = [0, 1, 2].map((i) => ({
    apex: top + h * 0.26 * i,
    foot: top + h * (0.42 + 0.26 * i),
    half: (width / 2) * (0.55 + 0.225 * i),
  }));
  const trunkTop = top + h * 0.94;
  return (
    <g>
      <rect
        className="fs-trunk"
        x={x - 1.2}
        y={trunkTop - 1}
        width={2.4}
        height={base - trunkTop + 1}
      />
      {tiers.map(({ apex, foot, half }) => (
        <path
          key={apex}
          className="fs-tree"
          d={`M${x} ${apex}L${x + half} ${foot}Q${x} ${foot + 1.6} ${x - half} ${foot}Z`}
        />
      ))}
      {tiers.map(({ apex, foot, half }) => {
        const drop = foot - apex;
        return (
          <path
            key={`cap-${apex}`}
            className="fs-snow-cap"
            d={`M${x} ${apex}L${x + half * 0.42} ${apex + drop * 0.42}Q${x + half * 0.2} ${apex + drop * 0.32} ${x} ${apex + drop * 0.46}Q${x - half * 0.2} ${apex + drop * 0.32} ${x - half * 0.42} ${apex + drop * 0.42}Z`}
          />
        );
      })}
      {decorated && (
        <>
          <circle className="fs-bauble-red" cx={x - 3.4} cy={top + h * 0.55} r={1.15} />
          <circle className="fs-bauble-gold" cx={x + 3.8} cy={top + h * 0.72} r={1.15} />
          <circle className="fs-bauble-blue" cx={x - 5.2} cy={top + h * 0.86} r={1.15} />
          <circle className="fs-bauble-red" cx={x + 6} cy={top + h * 0.9} r={1.15} />
          <path
            className="fs-star"
            d={`M${x} ${top - 4.2}l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z`}
          />
        </>
      )}
    </g>
  );
}

/** Santa in his sleigh, with the sack behind him and the reins to the team. */
function Sleigh() {
  return (
    <g>
      <path className="fs-rein" d="M44 17.4Q58 19 91 21L131 21L171 21L211 21" />
      <path className="fs-trace" d="M61 26L85 25L125 25L165 25L205 25" />
      <path className="fs-sack" d="M7 12Q5 3 12 2.6Q14 1 16 3Q22 4 19 13Z" />
      <path className="fs-tie" d="M11 4.2L14.6 3.6" />
      <path className="fs-red" d="M22 22.5Q21.5 13 29 11.4Q36 11 37.5 17L38 22.5Z" />
      <path className="fs-belt" d="M22.3 19.6L37.8 19.6" />
      <circle className="fs-skin" cx={29.8} cy={8.2} r={3.1} />
      <path
        className="fs-fur"
        d="M26.4 8.4Q26.8 13.6 30 14.4Q33.2 13.6 33.4 8.4Q30 10.6 26.4 8.4Z"
      />
      <path className="fs-red" d="M26.4 7Q27.6 1.6 32.4 2Q35.6 2.4 36.8 5.8L33.6 6.8Z" />
      <rect className="fs-fur" x={26} y={5.6} width={8.4} height={2.2} rx={1.1} />
      <circle className="fs-fur" cx={37.2} cy={6.4} r={1.4} />
      <path className="fs-arm" d="M33.5 14.5Q38 15 42 16.8" />
      <circle className="fs-fur" cx={42.4} cy={17} r={1.3} />
      <circle className="fs-mitten" cx={43.8} cy={17.4} r={1.2} />
      <path
        className="fs-red"
        d="M8 33L52 33Q60 33 61 26Q61.6 22 58 22L22 22Q16 22 13 16Q11 10 6 9.6Q2 10 2.6 15Q3.6 23 5 29Q5.8 33 8 33Z"
      />
      <path className="fs-gold-line" d="M7 29L56 29M5 14Q6.5 11.5 8.5 13Q9 15 7.4 15.6" />
      <path
        className="fs-runner"
        d="M3 38L54 38Q63 38 64 32Q64.6 28 61 28.6M14 33L14 38M30 33L30 38M46 33L46 38"
      />
    </g>
  );
}

/** A reindeer at full gallop, facing the way the sleigh rides. */
function Reindeer({ x, stride }: { x: number; stride: boolean }) {
  const legs = stride
    ? 'M22 27L26.5 32L28 35.5M20.5 27.6L24 33L24.5 36.5M10.5 27L6.5 31.5L3.5 33M12 27.6L9.5 32.6L7.5 36'
    : 'M22 27L22.5 32L24.5 35M20.5 27.6L19.5 33L21 36.5M10.5 27L12.5 32L11 36M12 27.6L14.5 32.5L13.5 36.5';
  return (
    <g transform={`translate(${x} 0)`}>
      <path className="fs-legs" d={legs} />
      <path className="fs-deer" d="M6.5 22.5Q4 21 3.8 23.4Q5 24 6.6 23.6Z" />
      <ellipse className="fs-deer" cx={16} cy={24} rx={10} ry={4.6} />
      <path className="fs-deer" d="M21.5 21Q24 17 25.8 13.2L29 14.6Q27.5 19 25.6 24Z" />
      <path
        className="fs-deer"
        d="M25.6 12.4Q28.6 10.6 31.6 12.2Q33.6 13 34 14.2Q33.4 15.6 31 15.4Q28.4 15.6 26.2 15Z"
      />
      <path className="fs-deer" d="M27 12L24.8 10.4L27.4 10.9Z" />
      <circle className="fs-eye" cx={29.4} cy={12.9} r={0.45} />
      <path
        className="fs-antler"
        d="M27.4 11.2Q26.2 8 24.4 5.6M25.6 7.6L23 7.2M25 6.6L25.4 4M28.6 11Q29.4 7.8 31 5.4M30 7.2L32.6 7M30.6 6.2L30.4 3.6"
      />
      <path className="fs-harness" d="M18.8 19.8Q20.2 24 18.8 28.4M23.2 20Q25.4 21.4 27 20.6" />
      <circle className="fs-bell" cx={19.4} cy={29.2} r={1} />
    </g>
  );
}
