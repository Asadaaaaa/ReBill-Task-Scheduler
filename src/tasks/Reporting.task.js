import { 
    OutletReportsModel, 
    BillModel, 
    OutletModel, 
    GeneralSettingModel, 
    PaymentMethodsModel, 
    ProductsModel, 
    RecipeModel, 
    ProductOutletModel, 
    RecipeOutletModel, 
    ProductCategoriesModel, 
    UsersModel,
    StaffModel,
    DailyFundsModel
} from "#models";
import moment from 'moment-timezone';

class ReportingTask {
    constructor(server) {
        this.server = server;
    }

    async run(start = null, end = null, exclusiveOwnerId = null) {
        this.getDailyReport(start, 'alloutlet', null, exclusiveOwnerId);
        return;
        try {
            // Get owners (level="owner" or "observer", verified=1, id != 1, id != 3)
            let ownersQuery = UsersModel.query()
                .whereIn('level', ['owner', 'observer'])
                .where('verified', 1)
                .where('id', '!=', 1)
                .where('id', '!=', 3);

            if (exclusiveOwnerId) {
                ownersQuery = ownersQuery.where('id', exclusiveOwnerId);
            }

            const owners = await ownersQuery.select('id', 'created_at', 'name', 'affiliate').get();
            const ownersArray = Array.isArray(owners) ? owners : (owners?.toArray ? owners.toArray() : []);
            
            this.server.sendLogs(`Active User Count: ${ownersArray.length}`);

            for (const owner of ownersArray) {
                this.server.sendLogs(`Processing Owner: ${owner.name}`);

                // Get outlets for owner
                let outlets = await OutletModel.query()
                    .select('id', 'outlet_name')
                    .where('owner_id', owner.id)
                    .get();
                let outletsArray = Array.isArray(outlets) ? outlets : (outlets?.toArray ? outlets.toArray() : []);

                if (await this.isObserver(owner.id)) {
                    const observer_outlet_list = JSON.parse(owner.affiliate || '[]');
                    outlets = await OutletModel.query()
                        .whereIn('owner_id', observer_outlet_list)
                        .get();
                    outletsArray = Array.isArray(outlets) ? outlets : (outlets?.toArray ? outlets.toArray() : []);
                } else {
                    if (!outletsArray || outletsArray.length === 0) {
                        continue; // Don't process outletless owner
                    }
                }

                // Process alloutlet report
                await this.saveAllOutletReport(null, owner.id, start, end);

                // Process each outlet
                for (const outlet of outletsArray) {
                    this.server.sendLogs(`Processing Outlet: ${owner.name} => ${outlet.outlet_name}`);
                    await this.saveAllOutletReport(outlet.id, owner.id, start, end);
                }

                // Process each outlet with staff reports
                for (const outlet of outletsArray) {
                    this.server.sendLogs(`Processing Outlet: ${owner.name} => ${outlet.outlet_name}`);
                    await this.saveAllOutletReport(outlet.id, owner.id, start, end, null);
                    
                    const staffOutlet = await StaffModel.query()
                        .select('id', 'name')
                        .where('outlet_id', outlet.id)
                        .get();
                    const staffOutletArray = Array.isArray(staffOutlet) ? staffOutlet : (staffOutlet?.toArray ? staffOutlet.toArray() : []);
                    for (const staff of staffOutletArray) {
                        this.server.sendLogs(`Processing Staff: ${owner.name} => ${outlet.outlet_name} => ${staff.name || `Staff ${staff.id}`}`);
                        await this.saveAllOutletReport(outlet.id, owner.id, start, end, staff.id);
                    }
                }
            }

            // Clean up old logs
            // await this.cleanupOldLogs();
        } catch (error) {
            console.error('Error in run:', error);
            this.server.sendLogs(`Error in run: ${error.message}`);
            throw error;
        }
    }

    async saveAllOutletReport(outletid = null, owner_id, start = null, end = null, staff = null) {
        try {
            if (!start) {
                // Start 2 days ago
                start = new Date();
                start.setDate(start.getDate() - 2);
            } else {
                start = new Date(start);
            }

            if (!end) {
                // End 2 days from now (handle -GMT timezone)
                end = new Date();
                end.setDate(end.getDate() + 2);
            } else {
                end = new Date(end);
                // Add 1 day to end
                end.setDate(end.getDate() + 1);
            }

            // Generate date range
            const dates = [];
            const currentDate = new Date(start);
            
            while (currentDate <= end) {
                const formattedDate = moment(currentDate).format('YYYY-MM-DD');
                dates.push(formattedDate);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Get owner, outlet, and staff names for logging
            let ownerName = 'Unknown';
            let outletName = outletid ? 'Unknown' : 'All Outlets';
            let staffName = staff ? 'Unknown' : 'All Staff';

            try {
                const owner = await UsersModel.query().select('name').find(owner_id);
                if (owner) {
                    ownerName = owner.name || 'Unknown';
                }
            } catch (e) {
                // Ignore error, use default
            }

            if (outletid) {
                try {
                    const outlet = await OutletModel.query().select('outlet_name').find(outletid);
                    if (outlet) {
                        outletName = outlet.outlet_name || 'Unknown';
                    }
                } catch (e) {
                    // Ignore error, use default
                }
            }

            if (staff) {
                try {
                    const staffRecord = await StaffModel.query().select('name').find(staff);
                    if (staffRecord) {
                        staffName = staffRecord.name || 'Unknown';
                    }
                } catch (e) {
                    // Ignore error, use default
                }
            }

            // Process each date
            for (const date of dates) {
                const outletId = outletid ?? 'alloutlet';
                this.server.sendLogs(`Processing reports for date: ${date}, owner: ${ownerName}, outlet: ${outletName}, staff: ${staffName}`);
                await this.getDailyReport(date, outletId, staff, owner_id, ownerName, outletName, staffName);
            }
        } catch (error) {
            console.error('Error in saveAllOutletReport:', error);
            this.server.sendLogs(`Error in saveAllOutletReport: ${error.message}`);
        }
    }

    // Helpers replicated from PHP logic (ported to JS)
    async getDailyReport(date, outletid, staff_id = null, owner_id) {
        console.log(date, outletid, staff_id, owner_id)
        const generalSetting = GeneralSettingModel.query().where('owner_id', owner_id).first();
        const decimal = (generalSetting && generalSetting.currency_decimals != null) ? generalSetting.currency_decimals : 0;
        const div = Math.pow(10, decimal);
        const chunkData = 250;

        const observer = await this.isObserver(owner_id);
        const datelinetime = (generalSetting && generalSetting.currency_decimals != null) ? generalSetting.datelinetime : '00:00';
        const hours = parseInt(datelinetime.split(':')[0]);
        const [year, month, day] = date.split('-');
        
        const stamp = moment(`${year}-${month}-${day}`).add(hours, 'hours').toDate();
        const tzOffset = await this.getTimezoneOffset(generalSetting);
        const start = moment(stamp).subtract(tzOffset, 'minutes').format('YYYY-MM-DD HH:mm:ss');
        const end = moment(stamp).add(1, 'day').subtract(1, 'second').subtract(tzOffset, 'minutes').format('YYYY-MM-DD HH:mm:ss');

        // Retrive Outlet Id's
        let listoutletid = [];
        if(outletid === 'alloutlet') {
            if (observer) {
                const owner = await UsersModel.query().where('id', owner_id).first();
                const observerAffiliateList = JSON.parse(owner.affiliate);
                let outlets = await OutletModel.query().select('id')
                .whereIn('owner_id', observerAffiliateList)
                .where('status', 'Premium')
                .get();

                listoutletid = outlets.pluck('id').toArray();
            } else {
                let outlets = await OutletModel.query().select('id')
                .where('owner_id', owner_id)
                .where('status', 'Premium')
                .get();

                listoutletid = outlets.pluck('id').toArray();
            }
            
            if(listoutletid.length === 0) return false;
        } else {
            listoutletid = [outletid];
        }

        // Retrive Daily Funds
        const dailyfundsData = await DailyFundsModel.query().whereIn('outlet_id', listoutletid)
        .where('date', date)
        .get();
        const dailyfunds = {
            fund: dailyfundsData.reduce((s, r) => s + (Number(r.fund) || 0), 0),
            expense: dailyfundsData.reduce((s, r) => s + (Number(r.expense) || 0), 0),
            remarks: dailyfundsData[0]?.remarks || ''
        };

        // Retrive Payment
        let payment = [];
        let paymentMethods = await PaymentMethodsModel.query().whereIn('outlet_id', listoutletid).get();
        for(let data of paymentMethods) {
            let check = false;
            
            for(let data2 of payment) {
                if(data.payment_name === data2.payment_method) check = true;
            }

            if(!check) payment.push({
                payment_method: data.payment_name,
                total: 0
            });
        }
        
        const billQuery = BillModel.query()
        .whereBetween('created_at', [start, end])
        .whereIn('outlet_id', listoutletid);
        if(staff_id !== null) billQuery.where('users_id', staff_id);

        let neededProductIDs = [];
        let neededRecipeIDs = [];

        await billQuery.chunk(chunkData, chunk => {
            for (const bill of chunk) {
                const items = JSON.parse(bill.order_collection);
                this.collectNeededProductAndRecipeIds(items, neededProductIDs, neededRecipeIDs);
            }
        });

        neededProductIDs = [...new Set(neededProductIDs)];
        neededRecipeIDs = [...new Set(neededRecipeIDs)];

        const productQuery = ProductsModel.query().withTrashed().whereIn('products_id', neededProductIDs);
        const recipesQuery = RecipeModel.query().withTrashed().whereIn('id', neededRecipeIDs);

    }

    async isObserver(owner_id) {
        if(!owner_id) return false;
        const userData = await UsersModel.query().select('level').where('id', owner_id).first();
        if(!userData) return false;
        return userData.level === 'observer' ? true : false;
    }

    async getTimezoneOffset(generalSetting) {
        const timezone = generalSetting.timezone ? generalSetting.timezone : "Asia/Jakarta";
        
        const userLocalTime = moment().tz((timezone));
        const userTimezoneOffset = userLocalTime.utcOffset();
        return userTimezoneOffset;
    }

    collectNeededProductAndRecipeIds(items, productIDs, recipeIDs) {
        for (const item of items) {
            if (item.options) {
                try {
                    let parsedOptions = item.options.filter(dataFilter => {
                        return (dataFilter.product_id && dataFilter.product_type) && dataFilter.type === 'complimentary';
                    });
                    
                    parsedOptions = this.mergeQuantities(parsedOptions);

                    for (const option of parsedOptions) {
                        if (option.product_type === "product") {
                            productIDs.push(option.product_id);
                        } else if (option.product_type === "recipe") {
                            recipeIDs.push(option.product_id);
                        }
                    }
                } catch (err) {
                    // This will skip the current 'item' if an error occurs
                    console.error("Error processing item:", err);
                    continue;
                }
            }

            // Always handle the base item regardless of options
            if (item && item.type != null && item.id != null) {
                if (item.type === 'product') {
                    productIDs.push(item.id);
                } else if (item.type === 'recipe') {
                    recipeIDs.push(item.id);
                }
            }
        }
    }

    mergeQuantities(items) {
        const merged = {};

        // Use .forEach() to iterate over the array (like PHP's ->each())
        items.forEach(item => {
            const key = `${item.product_type}_${item.product_id}`;

            if (!merged[key]) {
                merged[key] = { ...item, quantity: 1 };
            } else {
                merged[key].quantity++;
            }
        });
        
        return Object.values(merged);
    }
}

export default ReportingTask;