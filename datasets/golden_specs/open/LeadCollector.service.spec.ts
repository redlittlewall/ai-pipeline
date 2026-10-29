import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LeadCollectorService } from './LeadCollector.service';
import { LeadEntity } from '../../model/leads/Lead.entity';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { EmailSenderInterface } from 'modules/emailSender/EmailSenderInterface';

describe('LeadCollectorService', () => {
  let service: LeadCollectorService;
  let leadRepository: any;
  let clientRepository: any;
  let artistRepository: any;
  let emailSender: any;

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
    leadRepository = createMockRepository();
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    emailSender = {
      addContactToSegment: jest.fn(),
      createContactBatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadCollectorService,
        {
          provide: getRepositoryToken(LeadEntity),
          useValue: leadRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: EmailSenderInterface,
          useValue: emailSender,
        },
      ],
    }).compile();

    service = module.get<LeadCollectorService>(LeadCollectorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('collect', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should collect new lead and save it when valid input is provided', async () => {
      // Arrange
      process.env.BREVO_API_KEY = 'mock-key';
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue(null);
      leadRepository.findOne.mockResolvedValue(null);

      const input = [
        {
          email: 'test@example.com',
          name: 'John Doe',
          isArtist: false,
          phone: '123456789',
        } as any,
      ];

      // Act
      await service.collect(input);

      // Assert
      expect(leadRepository.save).toHaveBeenCalled();
      expect(emailSender.createContactBatch).toHaveBeenCalled();
    });

    it('should update existing lead instead of saving new one', async () => {
      // Arrange
      process.env.BREVO_API_KEY = 'mock-key';
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue(null);
      leadRepository.findOne.mockResolvedValue({
        id: 'existing-id',
        email: 'test@example.com',
      } as any);

      const input = [
        {
          email: 'test@example.com',
          name: 'John Doe',
          isArtist: false,
          phone: '123456789',
        } as any,
      ];

      // Act
      await service.collect(input);

      // Assert
      expect(leadRepository.update).toHaveBeenCalledWith(
        'existing-id',
        expect.any(Object),
      );
      expect(leadRepository.save).not.toHaveBeenCalled();
    });

    it('should replace email with client email when Apple Private Relay is used', async () => {
      // Arrange
      process.env.BREVO_API_KEY = 'mock-key';
      clientRepository.findOne.mockResolvedValue({
        email: 'real@example.com',
      } as any);
      artistRepository.findOne.mockResolvedValue(null);
      leadRepository.findOne.mockResolvedValue(null);

      const input = [
        {
          email: 'user@privaterelay.appleid.com',
          name: 'John Doe',
          isArtist: false,
          phone: '123456789',
        } as any,
      ];

      // Act
      await service.collect(input);

      // Assert
      expect(leadRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'real@example.com',
        }),
      );
    });

    it('should skip processing when Apple Private Relay email is used and no client is found', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue(null);

      const input = [
        {
          email: 'user@privaterelay.appleid.com',
          name: 'John Doe',
          isArtist: false,
          phone: '123456789',
        } as any,
      ];

      // Act
      await service.collect(input);

      // Assert
      expect(leadRepository.save).not.toHaveBeenCalled();
      expect(emailSender.createContactBatch).not.toHaveBeenCalled();
    });

    it('should not call emailSender when BREVO_API_KEY is missing', async () => {
      // Arrange
      delete process.env.BREVO_API_KEY;
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue(null);
      leadRepository.findOne.mockResolvedValue(null);

      const input = [
        {
          email: 'test@example.com',
          name: 'John Doe',
          isArtist: false,
          phone: '123456789',
        } as any,
      ];

      // Act
      await service.collect(input);

      // Assert
      expect(emailSender.createContactBatch).not.toHaveBeenCalled();
    });
  });
});
