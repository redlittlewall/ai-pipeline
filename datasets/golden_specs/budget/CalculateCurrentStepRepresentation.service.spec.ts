import { Test, TestingModule } from '@nestjs/testing';
import { CalculateCurrentStepRepresentationService } from './CalculateCurrentStepRepresentation.service';
import { BudgetStatus } from 'enums/BudgetStatus';

describe('CalculateCurrentStepRepresentationService', () => {
  let service: CalculateCurrentStepRepresentationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CalculateCurrentStepRepresentationService],
    }).compile();

    service = module.get<CalculateCurrentStepRepresentationService>(
      CalculateCurrentStepRepresentationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculate', () => {
    it('should return 0 when budget is null or undefined', () => {
      expect(service.calculate(true, null as any)).toBe(0);
      expect(service.calculate(false, undefined as any)).toBe(0);
    });

    it('should return 0 when status is PUBLIC_BUDGET_OFFER', () => {
      const budget = { status: BudgetStatus.PUBLIC_BUDGET_OFFER } as any;
      expect(service.calculate(true, budget)).toBe(0);
      expect(service.calculate(false, budget)).toBe(0);
    });

    describe('when isClient is true', () => {
      it('should return 0 for OPEN and BUDGET_OFFER statuses', () => {
        expect(
          service.calculate(true, { status: BudgetStatus.OPEN } as any),
        ).toBe(0);
        expect(
          service.calculate(true, { status: BudgetStatus.BUDGET_OFFER } as any),
        ).toBe(0);
      });

      it('should return 1 for PAYMENT_PENDING and PROCESSING_PAYMENT statuses', () => {
        expect(
          service.calculate(true, {
            status: BudgetStatus.PAYMENT_PENDING,
          } as any),
        ).toBe(1);
        expect(
          service.calculate(true, {
            status: BudgetStatus.PROCESSING_PAYMENT,
          } as any),
        ).toBe(1);
      });

      it('should return 2 for SCHEDULE_PENDING and SCHEDULE_OFFER statuses', () => {
        expect(
          service.calculate(true, {
            status: BudgetStatus.SCHEDULE_PENDING,
          } as any),
        ).toBe(2);
        expect(
          service.calculate(true, {
            status: BudgetStatus.SCHEDULE_OFFER,
          } as any),
        ).toBe(2);
      });

      it('should return 3 for SCHEDULED and MAKING_TATTOO statuses', () => {
        expect(
          service.calculate(true, { status: BudgetStatus.SCHEDULED } as any),
        ).toBe(3);
        expect(
          service.calculate(true, {
            status: BudgetStatus.MAKING_TATTOO,
          } as any),
        ).toBe(3);
      });

      it('should return 4 for MONEY_TRANSFER_PENDING status', () => {
        expect(
          service.calculate(true, {
            status: BudgetStatus.MONEY_TRANSFER_PENDING,
          } as any),
        ).toBe(4);
      });

      it('should return 5 for REVIEW status when finishedTattooClient is present', () => {
        const budget = {
          status: BudgetStatus.REVIEW,
          finishedTattooClient: new Date(),
        } as any;
        expect(service.calculate(true, budget)).toBe(5);
      });

      it('should return 4 for REVIEW status when finishedTattooClient is null', () => {
        const budget = {
          status: BudgetStatus.REVIEW,
          finishedTattooClient: null,
        } as any;
        expect(service.calculate(true, budget)).toBe(4);
      });

      it('should return 5 for FINISHED status', () => {
        expect(
          service.calculate(true, { status: BudgetStatus.FINISHED } as any),
        ).toBe(5);
      });

      it('should return -1 for REFOUNDED, CLOSED, and CLIENT_ABSENT statuses', () => {
        expect(
          service.calculate(true, { status: BudgetStatus.REFOUNDED } as any),
        ).toBe(-1);
        expect(
          service.calculate(true, { status: BudgetStatus.CLOSED } as any),
        ).toBe(-1);
        expect(
          service.calculate(true, {
            status: BudgetStatus.CLIENT_ABSENT,
          } as any),
        ).toBe(-1);
      });
    });

    describe('when isClient is false', () => {
      it('should return 0 for OPEN and BUDGET_OFFER statuses', () => {
        expect(
          service.calculate(false, { status: BudgetStatus.OPEN } as any),
        ).toBe(0);
        expect(
          service.calculate(false, {
            status: BudgetStatus.BUDGET_OFFER,
          } as any),
        ).toBe(0);
      });

      it('should return 1 for PAYMENT_PENDING and PROCESSING_PAYMENT statuses', () => {
        expect(
          service.calculate(false, {
            status: BudgetStatus.PAYMENT_PENDING,
          } as any),
        ).toBe(1);
        expect(
          service.calculate(false, {
            status: BudgetStatus.PROCESSING_PAYMENT,
          } as any),
        ).toBe(1);
      });

      it('should return 2 for SCHEDULE_PENDING and SCHEDULE_OFFER statuses', () => {
        expect(
          service.calculate(false, {
            status: BudgetStatus.SCHEDULE_PENDING,
          } as any),
        ).toBe(2);
        expect(
          service.calculate(false, {
            status: BudgetStatus.SCHEDULE_OFFER,
          } as any),
        ).toBe(2);
      });

      it('should return 3 for SCHEDULED and MAKING_TATTOO statuses', () => {
        expect(
          service.calculate(false, { status: BudgetStatus.SCHEDULED } as any),
        ).toBe(3);
        expect(
          service.calculate(false, {
            status: BudgetStatus.MAKING_TATTOO,
          } as any),
        ).toBe(3);
      });

      it('should return 6 for REVIEW status when finishedTattooArtist is present', () => {
        const budget = {
          status: BudgetStatus.REVIEW,
          finishedTattooArtist: new Date(),
        } as any;
        expect(service.calculate(false, budget)).toBe(6);
      });

      it('should return 5 for REVIEW status when finishedTattooArtist is null', () => {
        const budget = {
          status: BudgetStatus.REVIEW,
          finishedTattooArtist: null,
        } as any;
        expect(service.calculate(false, budget)).toBe(5);
      });

      it('should return 4 for MONEY_TRANSFER_PENDING status', () => {
        expect(
          service.calculate(false, {
            status: BudgetStatus.MONEY_TRANSFER_PENDING,
          } as any),
        ).toBe(4);
      });

      it('should return 6 for FINISHED status', () => {
        expect(
          service.calculate(false, { status: BudgetStatus.FINISHED } as any),
        ).toBe(6);
      });
    });
  });
});
