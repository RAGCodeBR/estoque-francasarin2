import { Icon } from '../../components/ui/Icon';
import { IMPORT_WIZARD_STEPS } from './import-wizard-state';

export function ImportStepper({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Etapas da importação" className="import-stepper">
      <div className="import-stepper__heading">
        <span>PROGRESSO</span>
        <strong>{String(currentStep).padStart(2, '0')} / 10</strong>
      </div>
      <ol>
        {IMPORT_WIZARD_STEPS.map((step) => {
          const complete = step.number < currentStep;
          const active = step.number === currentStep;
          return (
            <li
              aria-current={active ? 'step' : undefined}
              className={`${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`.trim()}
              key={step.number}
            >
              <span className="import-stepper__number">
                {complete ? <Icon name="check" size={15} /> : String(step.number).padStart(2, '0')}
              </span>
              <span className="import-stepper__copy">
                <small>ETAPA {String(step.number).padStart(2, '0')}</small>
                <strong>{step.shortLabel}</strong>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
