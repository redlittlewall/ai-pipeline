import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContactService } from './Contact.service';
import { Contact } from 'model/Contact.entity';
import { ContactType } from 'enums/ContactType';

describe('ContactService', () => {
  let service: ContactService;
  let contactRepository: any;

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

    contactRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
      exist: jest.fn().mockResolvedValue(false),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ id: 'mock-id', ...(entity || {}) }),
        ),
      create: jest.fn().mockImplementation((entity) => entity),
      update: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
      delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
      restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
      remove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn().mockImplementation(createQueryBuilderMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        {
          provide: getRepositoryToken(Contact),
          useValue: contactRepository,
        },
      ],
    }).compile();

    service = module.get<ContactService>(ContactService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createContact', () => {
    it('should create and save a contact successfully (Happy Path)', async () => {
      const userId = 'user-uuid-123';
      const text = 'This is a test message';
      const contactType = ContactType.SUPPORT;
      const email = 'user@example.com';

      await service.createContact(userId, text, contactType, email);

      expect(contactRepository.save).toHaveBeenCalledTimes(1);
      expect(contactRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          client: userId,
          email,
          text,
          answer: null,
          contactType,
        }),
      );
    });

    it('should propagate error when repository save fails (Sad Path)', async () => {
      contactRepository.save.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        service.createContact(
          'user-123',
          'Help needed',
          ContactType.BUG,
          'test@example.com',
        ),
      ).rejects.toThrow('Database error');
    });
  });
});
