import { Test, TestingModule } from '@nestjs/testing';
import { FillBlankDaysService } from './FillBlankDays.Service';
import { GenericChartDto } from 'model/dto/dashboard/GenericChartDto';
import { LineChartDataDto } from 'model/dto/dashboard/LineChartDataDto';
import { ChartPointDto } from 'model/dto/dashboard/ChartPointDto';

describe('FillBlankDaysService', () => {
  let service: FillBlankDaysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FillBlankDaysService],
    }).compile();

    service = module.get<FillBlankDaysService>(FillBlankDaysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fill', () => {
    it('should fill missing days and sort points across lines (Happy Path)', async () => {
      // Given (Arrange)
      const startDate = new Date(2023, 0, 1, 12, 0, 0);
      const endDate = new Date(2023, 0, 4, 12, 0, 0);

      const existingPointLine1 = new ChartPointDto(
        new Date(2023, 0, 2, 12, 0, 0).toISOString(),
        50,
      );
      const line1 = new LineChartDataDto('Line 1', '#fff', [
        existingPointLine1,
      ]);

      const chartDto = new GenericChartDto('Test Chart', [line1], null);

      // When (Act)
      const result = await service.fill(
        startDate.toISOString(),
        endDate.toISOString(),
        chartDto,
      );

      // Then (Assert)
      expect(result).toBeDefined();
      expect(result.lines[0].points).toHaveLength(3); // Jan 1, Jan 2, Jan 3

      const dates = result.lines[0].points.map((p) => new Date(p.x).getDate());
      expect(dates).toEqual([1, 2, 3]);

      // Jan 2 should keep the original value 50, others should be 0
      const pointJan2 = result.lines[0].points.find(
        (p) => new Date(p.x).getDate() === 2,
      );
      const pointJan1 = result.lines[0].points.find(
        (p) => new Date(p.x).getDate() === 1,
      );
      expect(pointJan2?.y).toBe(50);
      expect(pointJan1?.y).toBe(0);
    });

    it('should handle chart with multiple lines and empty initial points', async () => {
      // Given (Arrange)
      const startDate = new Date(2023, 4, 10, 12, 0, 0);
      const endDate = new Date(2023, 4, 12, 12, 0, 0);

      const line1 = new LineChartDataDto('Line 1', '#ff0000', []);
      const line2 = new LineChartDataDto('Line 2', '#00ff00', []);
      const chartDto = new GenericChartDto(
        'Multi Line Chart',
        [line1, line2],
        null,
      );

      // When (Act)
      const result = await service.fill(
        startDate.toISOString(),
        endDate.toISOString(),
        chartDto,
      );

      // Then (Assert)
      expect(result.lines[0].points).toHaveLength(2); // May 10 and May 11
      expect(result.lines[1].points).toHaveLength(2);
      expect(result.lines[0].points[0].y).toBe(0);
      expect(result.lines[1].points[0].y).toBe(0);
    });

    it('should not add days when start date is greater than or equal to end date (Edge Case)', async () => {
      // Given (Arrange)
      const startDate = new Date(2023, 0, 5, 12, 0, 0);
      const endDate = new Date(2023, 0, 5, 12, 0, 0);

      const line = new LineChartDataDto('Line 1', '#000', []);
      const chartDto = new GenericChartDto(
        'Empty Interval Chart',
        [line],
        null,
      );

      // When (Act)
      const result = await service.fill(
        startDate.toISOString(),
        endDate.toISOString(),
        chartDto,
      );

      // Then (Assert)
      expect(result.lines[0].points).toHaveLength(0);
    });

    it('should handle chart with no lines', async () => {
      // Given (Arrange)
      const startDate = new Date(2023, 0, 1, 12, 0, 0);
      const endDate = new Date(2023, 0, 3, 12, 0, 0);
      const chartDto = new GenericChartDto('No Lines Chart', [], null);

      // When (Act)
      const result = await service.fill(
        startDate.toISOString(),
        endDate.toISOString(),
        chartDto,
      );

      // Then (Assert)
      expect(result.lines).toHaveLength(0);
    });
  });

  describe('sortPoints', () => {
    it('should sort points chronologically in ascending order (Happy Path)', () => {
      // Given (Arrange)
      const point1 = new ChartPointDto(
        new Date(2023, 0, 3, 12, 0, 0).toISOString(),
        30,
      );
      const point2 = new ChartPointDto(
        new Date(2023, 0, 1, 12, 0, 0).toISOString(),
        10,
      );
      const point3 = new ChartPointDto(
        new Date(2023, 0, 2, 12, 0, 0).toISOString(),
        20,
      );

      const line = new LineChartDataDto('Line 1', '#fff', [
        point1,
        point2,
        point3,
      ]);

      // When (Act)
      service.sortPoints(line);

      // Then (Assert)
      expect(line.points[0].x).toBe(point2.x);
      expect(line.points[1].x).toBe(point3.x);
      expect(line.points[2].x).toBe(point1.x);
    });

    it('should handle already sorted points and single-item lists (Edge Case)', () => {
      // Given (Arrange)
      const point1 = new ChartPointDto(
        new Date(2023, 0, 1, 12, 0, 0).toISOString(),
        10,
      );
      const line = new LineChartDataDto('Single Point Line', '#fff', [point1]);

      // When (Act)
      service.sortPoints(line);

      // Then (Assert)
      expect(line.points).toHaveLength(1);
      expect(line.points[0].x).toBe(point1.x);
    });
  });

  describe('fixDay', () => {
    it('should insert a 0 point if date does not exist in points (Happy Path)', () => {
      // Given (Arrange)
      const currentDate = new Date(2023, 0, 15, 12, 0, 0);
      const line = new LineChartDataDto('Line 1', '#fff', []);

      // When (Act)
      service.fixDay(currentDate, line);

      // Then (Assert)
      expect(line.points).toHaveLength(1);
      expect(line.points[0].y).toBe(0);
      const addedDate = new Date(line.points[0].x);
      expect(addedDate.getFullYear()).toBe(2023);
      expect(addedDate.getMonth()).toBe(0);
      expect(addedDate.getDate()).toBe(15);
    });

    it('should not add point if a point already exists for that day (Branch Coverage)', () => {
      // Given (Arrange)
      const currentDate = new Date(2023, 0, 15, 14, 30);
      const existingDate = new Date(2023, 0, 15, 8, 0);
      const existingPoint = new ChartPointDto(existingDate.toISOString(), 100);
      const line = new LineChartDataDto('Line 1', '#fff', [existingPoint]);

      // When (Act)
      service.fixDay(currentDate, line);

      // Then (Assert)
      expect(line.points).toHaveLength(1);
      expect(line.points[0].y).toBe(100);
    });
  });
});
