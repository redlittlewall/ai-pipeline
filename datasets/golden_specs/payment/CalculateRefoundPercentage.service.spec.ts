import { Test, TestingModule } from '@nestjs/testing';
import { CalculateRefoundPercentageService } from './CalculateRefoundPercentage.service';

describe('CalculateRefoundPercentageService', () => {
  let service: CalculateRefoundPercentageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CalculateRefoundPercentageService],
    }).compile();

    service = module.get<CalculateRefoundPercentageService>(
      CalculateRefoundPercentageService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
      jest.restoreAllMocks();
    });

    it('should return MIN_REFOUND_TAX when approvedSchedule is null', () => {
      process.env.MIN_REFOUND_TAX = '10';

      const result = service.handle(null as any);

      expect(result).toBe(10);
    });

    it('should return MAX_REFOUND_TAX when date is 3 or more days away', () => {
      process.env.MAX_REFOUND_TAX = '50';
      const now = new Date('2023-01-01T00:00:00Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // 4 days in the future
      const schedule = { date: new Date('2023-01-05T00:00:00Z') } as any;

      const result = service.handle(schedule);

      expect(result).toBe(50);
    });

    it('should return MED_REFOUND_TAX when date is less than 3 days away', () => {
      process.env.MED_REFOUND_TAX = '30';
      const now = new Date('2023-01-01T00:00:00Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // 1 day in the future
      const schedule = { date: new Date('2023-01-02T00:00:00Z') } as any;

      const result = service.handle(schedule);

      expect(result).toBe(30);
    });
  });
});
