import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LegalService } from './Legal.service';
import { LegalDocument } from '../../model/legal/LegalDocument.entity';
import { UserLegalAcceptance } from '../../model/legal/UserLegalAcceptance.entity';
import { NotFoundException } from '@nestjs/common';
import { LegalDocumentType } from '../../enums/LegalDocumentType';

describe('LegalService', () => {
  let service: LegalService;
  let legalDocumentRepository: any;
  let userAcceptanceRepository: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    legalDocumentRepository = createMockRepository();
    userAcceptanceRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalService,
        {
          provide: getRepositoryToken(LegalDocument),
          useValue: legalDocumentRepository,
        },
        {
          provide: getRepositoryToken(UserLegalAcceptance),
          useValue: userAcceptanceRepository,
        },
      ],
    }).compile();

    service = module.get<LegalService>(LegalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFirstPendingDocumentType', () => {
    it('should return null when no active documents exist', async () => {
      legalDocumentRepository.find.mockResolvedValueOnce([]);
      const result = await service.getFirstPendingDocumentType('user-1');
      expect(result).toBeNull();
    });

    it('should return PRIVACY_POLICY when it is active and not accepted', async () => {
      legalDocumentRepository.find.mockResolvedValueOnce([
        { id: 'doc-1', type: LegalDocumentType.PRIVACY_POLICY },
      ] as any);
      userAcceptanceRepository.find.mockResolvedValueOnce([]);

      const result = await service.getFirstPendingDocumentType('user-1');
      expect(result).toBe(LegalDocumentType.PRIVACY_POLICY);
    });

    it('should return TERMS_OF_USE when privacy is accepted but terms are not', async () => {
      legalDocumentRepository.find.mockResolvedValueOnce([
        { id: 'doc-1', type: LegalDocumentType.PRIVACY_POLICY },
        { id: 'doc-2', type: LegalDocumentType.TERMS_OF_USE },
      ] as any);
      userAcceptanceRepository.find.mockResolvedValueOnce([
        { legalDocumentId: 'doc-1' },
      ] as any);

      const result = await service.getFirstPendingDocumentType('user-1');
      expect(result).toBe(LegalDocumentType.TERMS_OF_USE);
    });

    it('should return null when all active documents are accepted', async () => {
      legalDocumentRepository.find.mockResolvedValueOnce([
        { id: 'doc-1', type: LegalDocumentType.PRIVACY_POLICY },
        { id: 'doc-2', type: LegalDocumentType.TERMS_OF_USE },
      ] as any);
      userAcceptanceRepository.find.mockResolvedValueOnce([
        { legalDocumentId: 'doc-1' },
        { legalDocumentId: 'doc-2' },
      ] as any);

      const result = await service.getFirstPendingDocumentType('user-1');
      expect(result).toBeNull();
    });
  });

  describe('getActiveDocument', () => {
    it('should return the document when found', async () => {
      const mockDoc = { id: 'doc-1', type: LegalDocumentType.PRIVACY_POLICY };
      legalDocumentRepository.findOne.mockResolvedValueOnce(mockDoc as any);

      const result = await service.getActiveDocument(
        LegalDocumentType.PRIVACY_POLICY,
      );
      expect(result).toEqual(mockDoc);
      expect(legalDocumentRepository.findOne).toHaveBeenCalledWith({
        where: { type: LegalDocumentType.PRIVACY_POLICY, isActive: true },
      });
    });

    it('should throw NotFoundException when document is not found', async () => {
      legalDocumentRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.getActiveDocument(LegalDocumentType.PRIVACY_POLICY),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('registerAcceptance', () => {
    it('should return existing acceptance if already accepted', async () => {
      legalDocumentRepository.findOne.mockResolvedValueOnce({
        id: 'doc-1',
      } as any);
      const existing = {
        id: 'acc-1',
        userId: 'user-1',
        legalDocumentId: 'doc-1',
      };
      userAcceptanceRepository.findOne.mockResolvedValueOnce(existing as any);

      const result = await service.registerAcceptance(
        'user-1',
        'doc-1',
        '127.0.0.1',
      );
      expect(result).toEqual(existing);
      expect(userAcceptanceRepository.save).not.toHaveBeenCalled();
    });

    it('should create and save new acceptance if not accepted yet', async () => {
      legalDocumentRepository.findOne.mockResolvedValueOnce({
        id: 'doc-1',
      } as any);
      userAcceptanceRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.registerAcceptance(
        'user-1',
        'doc-1',
        '127.0.0.1',
      );
      expect(userAcceptanceRepository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException if document does not exist', async () => {
      legalDocumentRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.registerAcceptance('user-1', 'invalid-id', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createDocument', () => {
    it('should deactivate previous documents when creating a new active one', async () => {
      const dto = {
        type: LegalDocumentType.PRIVACY_POLICY,
        isActive: true,
        version: '1.0',
        title: 'Title',
        content: 'Content',
      } as any;

      await service.createDocument(dto);

      expect(legalDocumentRepository.update).toHaveBeenCalledWith(
        { type: LegalDocumentType.PRIVACY_POLICY, isActive: true },
        { isActive: false },
      );
      expect(legalDocumentRepository.save).toHaveBeenCalled();
    });

    it('should not deactivate previous documents when creating an inactive one', async () => {
      const dto = {
        type: LegalDocumentType.PRIVACY_POLICY,
        isActive: false,
        version: '1.0',
        title: 'Title',
        content: 'Content',
      } as any;

      await service.createDocument(dto);

      expect(legalDocumentRepository.update).not.toHaveBeenCalled();
      expect(legalDocumentRepository.save).toHaveBeenCalled();
    });
  });
});
