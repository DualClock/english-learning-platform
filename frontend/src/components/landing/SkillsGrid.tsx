import LevelChip from '@/components/ui/LevelChip';
import ProgressBar from '@/components/ui/ProgressBar';
import { MicIcon, VolumeIcon } from '@/components/ui/icons';
import { RevealGroup, RevealItem } from './Reveal';

const QUALITY = [
  { label: 'Забыл', tone: 'bg-surface-danger text-on-danger' },
  { label: 'Трудно', tone: 'bg-surface-warning text-on-warning' },
  { label: 'Хорошо', tone: 'bg-surface-success text-on-success' },
  { label: 'Легко', tone: 'bg-primary text-on-primary' },
];

function DictionaryTile() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-primary p-6 text-on-primary sm:p-8">
      <h3 className="text-h2">Словарь, который помнит</h3>
      <p className="mt-2 text-body">
        Нажми на слово в книге или добавь своё. Интервалы повторений подстроятся под то, как ты
        отвечаешь.
      </p>

      <div data-ui className="mt-7 rounded-lg bg-canvas p-5 text-ink">
        <div className="flex items-center justify-between gap-3 text-caption text-slate">
          <span>Слово 3 из 8</span>
          <span>Повторение</span>
        </div>

        <div className="mt-4 text-center">
          <p className="font-heading text-h1 text-ink">curious</p>
          <p className="mt-1 text-caption text-slate">/ˈkjʊəriəs/ · прилагательное</p>
          <p className="mt-3 text-h3 text-ink">любопытный</p>
          <p className="mt-2 text-body-sm italic text-slate">
            «I’m curious about everything.»
          </p>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-1.5">
          {QUALITY.map((option) => (
            <span
              key={option.label}
              className={`rounded-md px-1 py-2 text-center text-caption font-medium ${option.tone}`}
            >
              {option.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrammarTile() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-surface p-6 sm:p-8">
      <h3 className="text-h2 text-ink">Грамматика короткими уроками</h3>
      <p className="mt-2 text-body text-charcoal">
        Теория на один экран и упражнения сразу после неё. Прогресс сохраняется по юнитам.
      </p>

      <div className="mt-auto pt-7">
        <div data-ui className="rounded-lg bg-canvas p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-caption text-slate">Юнит грамматики</span>
            <LevelChip level="a2" />
          </div>
          <p className="mt-2 text-h3 text-ink">Past Simple</p>
          <p className="mt-1 text-body-sm text-slate">
            Законченное действие в прошлом: -ed у правильных глаголов и вторая форма у
            неправильных.
          </p>
          <div className="mt-4 flex items-center justify-between text-caption text-slate">
            <span>Твой прогресс</span>
            <span className="tabular-nums">50%</span>
          </div>
          <ProgressBar value={50} label="Прогресс юнита Past Simple" className="mt-1.5" />
        </div>
      </div>
    </div>
  );
}

function PronunciationTile() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-surface-info p-6 sm:p-8">
      <h3 className="text-h2 text-ink">Произношение без стеснения</h3>
      <p className="mt-2 text-body text-charcoal">
        Слушай похожие слова, записывай себя и получай разбор: что именно поправить.
      </p>

      <div className="mt-auto pt-7">
        <div data-ui className="rounded-lg bg-canvas p-5">
          <div className="flex items-center justify-between gap-3 text-caption text-slate">
            <span>Минимальные пары</span>
            <span>Практика</span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5">
              <span className="text-h3 text-ink">ship</span>
              <span className="text-caption text-slate">/ʃɪp/</span>
              <span className="ml-auto text-body-sm text-charcoal">корабль</span>
              <VolumeIcon size={16} className="text-slate" aria-hidden />
            </div>
            <div className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5">
              <span className="text-h3 text-ink">sheep</span>
              <span className="text-caption text-slate">/ʃiːp/</span>
              <span className="ml-auto text-body-sm text-charcoal">овца</span>
              <VolumeIcon size={16} className="text-slate" aria-hidden />
            </div>
          </div>

          <p className="mt-4 flex items-center gap-2 text-caption font-medium text-charcoal">
            <MicIcon size={16} className="text-primary" aria-hidden />
            Теперь скажи «ship» вслух
          </p>
        </div>
      </div>
    </div>
  );
}

function WritingTile() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-tint-lavender p-6 sm:p-8">
      <h3 className="text-h2 text-ink">Письмо с разбором</h3>
      <p className="mt-2 text-body text-charcoal">
        Пиши короткие тексты и получай оценку с объяснением каждой правки.
      </p>

      <div className="mt-auto pt-7">
        <div data-ui className="rounded-lg bg-canvas p-5">
          <div className="flex items-center justify-between gap-3 text-caption text-slate">
            <span>Письмо другу</span>
            <span>A2–B1</span>
          </div>
          <p className="mt-3 text-body text-ink">
            Yesterday I{' '}
            <span className="text-on-danger line-through">have went</span> to the park with my
            sister.
          </p>
          <div className="mt-4 rounded-md bg-surface-success px-3 py-2.5">
            <p className="text-caption font-medium text-on-success">have went → went</p>
            <p className="mt-0.5 text-caption text-on-success">
              С yesterday используем Past Simple.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SkillsGrid() {
  return (
    <section id="skills" className="bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <RevealGroup className="grid gap-x-12 gap-y-5 lg:grid-cols-12">
          <RevealItem className="lg:col-span-7">
            <h2 className="text-h1 text-ink">Английский не заканчивается книгой</h2>
          </RevealItem>
          <RevealItem className="lg:col-span-5 lg:pt-2">
            <p className="max-w-measure-sm text-body-lg text-charcoal">
              Слова, грамматика, произношение и письмо живут в одном профиле. Всё, что ты разобрал,
              возвращается в повторения.
            </p>
          </RevealItem>
        </RevealGroup>

        <RevealGroup className="mt-12 grid gap-5 lg:grid-cols-12">
          <RevealItem className="lg:col-span-7">
            <DictionaryTile />
          </RevealItem>
          <RevealItem className="lg:col-span-5">
            <GrammarTile />
          </RevealItem>
          <RevealItem className="lg:col-span-5">
            <PronunciationTile />
          </RevealItem>
          <RevealItem className="lg:col-span-7">
            <WritingTile />
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}
