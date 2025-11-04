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
        let observerAffiliateList = [];
        if(outletid === 'alloutlet') {
            if (observer) {
                const owner = await UsersModel.query().where('id', owner_id).first();
                observerAffiliateList = JSON.parse(owner.affiliate);
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

        if(observer) {
            productQuery.whereIn('owner_id', observerAffiliateList);
            recipesQuery.whereIn('owner_id', observerAffiliateList);
        } else {
            productQuery.whereIn('owner_id', owner_id);
            recipesQuery.whereIn('owner_id', owner_id);
        }

        const products = (await productQuery.get()).keyBy('products_id');
        const productOutlets = await ProductOutletModel.query().whereIn('outlet_id', listoutletid).whereIn('products_id', neededProductIDs).get();
        const recipes = (await recipesQuery.get()).keyBy('id');
        const recipeOutlets = await RecipeOutletModel.query().whereIn('outlet_id', listoutletid).whereIn('recipe_id', neededRecipeIDs).get();
        const categories = await ProductCategoriesModel.query().where('owner_id', owner_id).get();

        let bills = [];
        let totalsales = 0;
        let fee = 0, grat = 0, vat = 0, disc = 0, rounding = 0;
        let order = [];
        let statesOrder = [];

        await billQuery.chunk(chunkData, chunk => {
            for (const bill of chunk) {
                bills.push(bill);
                totalsales += bill.total / div;
                fee += this.getFee([bill]) / div;
                grat += this.getGrat([bill]) / div;
                vat += this.getVat([bill]) / div;
                disc += this.getDiscount([bill]) / div;
                rounding += this.getRoundingOnly([bill], owner_id) / div;

                statesOrder.push(bill.states);

                let method = bill.payment_method ?? 'Unpaid';
                let check = 0;

                method = this.formatMerchantPaymentMethod(method, bill);

                for (let keypayment = 0; keypayment < payment.length; keypayment++) {
                    const pay = payment[keypayment];
                    const contains = bill.payment_method && bill.payment_method.includes(' and ');
                    
                    if (contains === true) {
                        method = "Split Pay";
                        if (bill.split_payment != null && bill.split_payment != "") {
                            const sps = JSON.parse(bill.split_payment);
                            for (const sp of sps) {
                                if (pay.payment_method === sp.method) {
                                    payment[keypayment].total += this.parseBillSp(sp.amount, owner_id, generalSetting);
                                    check = 1;
                                }
                            }
                        }
                    }

                    if (bill.payment_method == null) {
                        method = "Unpaid";
                    }

                    if (check == 0 && pay.payment_method === method) {
                        payment[keypayment].total += this.totalRevenueFromBill(bill, owner_id) / div;
                        check = 1;
                    }
                }

                if (check == 0) {
                    const contains = bill.payment_method && bill.payment_method.includes(' and ');
                    if (contains === true) {
                        method = "Split Pay";
                        if (bill.split_payment != null && bill.split_payment != "") {
                            const sps = JSON.parse(bill.split_payment);
                            for (const sp of sps) {
                                const existingPayment = payment.find(p => p.payment_method === sp.method);
                                if (existingPayment) {
                                    existingPayment.total += this.parseBillSp(sp.amount, owner_id, generalSetting);
                                } else {
                                    payment.push({ payment_method: sp.method, total: this.parseBillSp(sp.amount, owner_id, generalSetting) });
                                }
                                check = 1;
                            }
                        }
                    }
                    if (bill.payment_method == null) {
                        method = "Unpaid";
                    }
                    if (check == 0) {
                        payment.push({ payment_method: method, total: this.totalRevenueFromBill(bill, owner_id) / div });
                    }
                }

                const collections = this.unpackBillCollection(JSON.parse(bill.order_collection), owner_id, products, productOutlets, recipes, recipeOutlets, categories);
                for (const collection of collections) {
                    const count = collection.quantity;
                    const total = this.totalRevenueFromOrder(collection, bill) * count / div;
                    let category = 'Uncategorized';

                    if (collection.type === 'product') {
                        const product = products.get(collection.id);
                        category = product?.products_type ?? category;
                    } else if (collection.type === 'special') {
                        category = 'Special';
                    } else if (collection.type === 'recipe') {
                        const recipe = recipes.get(collection.id);
                        category = recipe ? recipe.products_type : category;
                    } else if (collection.type === 'custom') {
                        category = collection.category ?? category;
                    }

                    let found = false;
                    for (const item of order) {
                        if (item[0] === category) {
                            item[1] += count;
                            item[2] += total;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        order.push([category, count, total]);
                    }
                }
            }
        });

        const totaldailybills = this.getRevenue(bills, true) / div;
        let taxordisc = 'none';
        if ((fee + grat + vat) > 0 && disc > 0) {
            taxordisc = 'all';
        } else if ((fee + grat + vat) > 0) {
            taxordisc = 'tax';
        } else if (disc > 0) {
            taxordisc = 'disc';
        }

        const filteredPayment = payment.filter(p => p.total != 0);

        const result = [
            order, filteredPayment, totaldailybills, totalsales,
            taxordisc, fee, grat, vat, disc, rounding,
            dailyfunds, statesOrder
        ];

        await this.createOutletReport(
            (outletid === 'alloutlet' ? null : outletid),
            owner_id,
            staff_id,
            date,
            'daily',
            JSON.stringify(result)
        );

        return result;
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

    getFee(bill) {
        let servicefee = 0;
        for (const b of bill) {
            servicefee += Math.floor(this.getPrice(b) * b.servicefee / 100);
        }
        return servicefee;
    }

    getGrat(bill) {
        let gratuity = 0;
        for (const b of bill) {
            gratuity += Math.floor(this.getPrice(b) * b.gratuity / 100);
        }
        return gratuity;
    }

    getVat(bill) {
        let vat = 0;
        for (const b of bill) {
            vat += Math.floor((Math.floor(this.getPrice(b))
                + Math.floor(this.getPrice(b) * b.servicefee / 100)
                + Math.floor(this.getPrice(b) * b.gratuity / 100))
                * b.vat / 100);
        }
        return vat;
    }

    getDiscount(bill) {
        let discount = 0;
        for (const b of bill) {
            discount += b.total_discount;
            discount += this.calculateProductDiscount(b);
        }
        return discount;
    }

    getRoundingOnly(bill, owner_id = null) {
        if (!Array.isArray(bill)) {
            bill = [bill];
        }

        let rounding = 0;

        for (const b of bill) {
            const order_collection = JSON.parse(b.order_collection);
            let isPastBill = false;

            for (const item of order_collection) {
                if (!item.discount_rules && !item.discount_type2 && item.type != 'special') {
                    isPastBill = true;
                    break;
                }
            }

            b.total = Math.ceil(b.total);
            b.totaldiscount = b.total_discount;
            if (isPastBill) {
                b.product_discount = this.calculateProductDiscountNull(b);
            } else {
                b.product_discount = this.calculateProductDiscount(b);
            }
            b.totalafterdiscount = Math.floor(b.total - b.totaldiscount - b.product_discount - b.total_reward);
            b.totalgratuity = Math.floor(b.totalafterdiscount * b.gratuity / 100);
            b.totalservicefee = Math.floor(b.totalafterdiscount * b.servicefee / 100);
            b.totalbeforetax = Math.floor(b.totalgratuity + b.totalservicefee + b.totalafterdiscount);
            b.totalvat = Math.floor(b.totalbeforetax * b.vat / 100);
            b.totalaftertax = Math.floor(b.totalbeforetax + (b.totalbeforetax * b.vat / 100));

            b.rounding_setting = b.rounding;
            b.totalafterrounding = b.totalaftertax;
            if (b.rounding != 1 && b.rounding != 0) {
                b.totalafterrounding = this.priceRounding(b.totalaftertax, b.rounding);
                b.rounding = b.totalafterrounding - b.totalaftertax;
            } else {
                b.rounding = 0;
            }

            rounding += b.rounding;
        }

        return rounding;
    }

    getPrice(bill) {
        return bill.total || 0;
    }

    calculateProductDiscount(bill) {
        // Placeholder - implement based on your business logic
        return 0;
    }

    calculateProductDiscountNull(bill) {
        // Placeholder - implement based on your business logic
        return 0;
    }

    priceRounding(price, roundingSetting) {
        // Placeholder - implement your rounding logic
        return Math.round(price);
    }

    totalSalesPriceFromBill(bill) {
        return Math.floor(bill.total - bill.total_discount - this.calculateProductDiscount(bill) - bill.total_reward);
    }

    totalServiceFeeFromBill(bill) {
        return Math.floor(this.totalSalesPriceFromBill(bill) * bill.servicefee / 100);
    }

    totalGratuityFromBill(bill) {
        return Math.floor(this.totalSalesPriceFromBill(bill) * bill.gratuity / 100);
    }

    totalAddedTaxFromBill(bill) {
        return Math.floor((this.totalSalesPriceFromBill(bill)
            + this.totalServiceFeeFromBill(bill)
            + this.totalGratuityFromBill(bill))
            * bill.vat / 100);
    }

    getRevenue(value, includeRounding = false) {
        let total = 0;

        for (const g of value) {
            if (includeRounding) {
                if (g.final_total !== undefined) {
                    total += g.final_total;
                    continue;
                }
                total += Math.ceil(this.getRoundingOnly([g]));
            }
            total += Math.floor(this.totalSalesPriceFromBill(g))
                + Math.floor(this.totalServiceFeeFromBill(g))
                + Math.floor(this.totalGratuityFromBill(g))
                + Math.floor(this.totalAddedTaxFromBill(g));
        }
        return total;
    }

    totalRevenueFromBill(bill, owner_id = null) {
        if (bill.final_total !== undefined) {
            return bill.final_total;
        }
        const total = Math.floor(this.totalSalesPriceFromBill(bill))
            + Math.floor(this.totalServiceFeeFromBill(bill))
            + Math.floor(this.totalGratuityFromBill(bill))
            + Math.floor(this.totalAddedTaxFromBill(bill))
            + Math.ceil(this.getRoundingOnly([bill], owner_id));
        return total;
    }

    totalRevenueFromOrder(order, bill) {
        return order.price;
    }

    formatMerchantPaymentMethod(method, bill) {
        if (method == 'Merchant') {
            return `${bill.customer_name} (${bill.payment_method})`;
        }
        return method;
    }

    parseBillSp(amount, owner_id = null, setting = null) {
        const decimal = setting?.decimal ?? 0;
        if (decimal == 0) {
            amount = amount.toString().replace(/\./g, "");
            return amount.replace(/,/g, "");
        } else {
            return amount.toString().replace(/,/g, "");
        }
    }

    unpackBillCollection(itemlist, owner_id = null, products = null, productOutlets = null, recipes = null, recipeOutlets = null, categories = null) {
        const itemList = Array.isArray(itemlist) ? itemlist : [];
        const result = [...itemList];

        try {
            for (const item of itemList) {
                if (!item.options) continue;

                try {
                    let parsedOptions = item.options.filter(dataFilter => {
                        return (dataFilter.product_id && dataFilter.product_type) && dataFilter.type === 'complimentary';
                    });

                    parsedOptions = this.mergeQuantities(parsedOptions);

                    if (parsedOptions.length === 0) {
                        continue;
                    }

                    for (const option of parsedOptions) {
                        let product = null;
                        let product_outlet = null;
                        let category = null;

                        if (option.product_type == "product") {
                            product = products.get(option.product_id);
                            product_outlet = productOutlets.find(po => po.products_id == option.product_id);
                        } else if (option.product_type == "recipe") {
                            product = recipes.get(option.product_id);
                            product_outlet = recipeOutlets.find(ro => ro.recipe_id == option.product_id);
                        }

                        if (!product || !product_outlet) continue;

                        category = categories.find(c => c.categories_name == product.products_type);
                        if (!category) continue;

                        const newItem = {
                            id: option.product_id,
                            name: product.products_name,
                            price: 0,
                            quantity: (option.quantity ?? 1) * item.quantity,
                            type: option.product_type,
                            purchprice: product_outlet.purchPrice,
                            includedtax: product_outlet.tax,
                            options: null,
                            category: category.categories_name,
                            category_bill_printer: category.bill_printer,
                            productNotes: null,
                            infinitystock: product_outlet.infinitystock,
                            original_price: product_outlet.products_price,
                            original_purchprice: product_outlet.purchPrice
                        };
                        result.push(newItem);
                    }
                } catch (err) {
                    console.error("Error processing item:", err);
                    continue;
                }
            }
        } catch (e) {
            console.error("Error unpacking bill collection:", e);
        }

        return result;
    }

    async createOutletReport(outlet_id, owner_id, staff_id, date, type, data) {
        // Implement the logic to save outlet report to database
        // This should match the createOutletReport function from PHP
        try {
            await OutletReportsModel.query()
                .where('outlet_id', outlet_id)
                .where('owner_id', owner_id)
                .where('staff_id', staff_id)
                .where('date', date)
                .where('type', type)
                .delete();

            await OutletReportsModel.query().insert({
                outlet_id: outlet_id,
                owner_id: owner_id,
                staff_id: staff_id,
                date: date,
                type: type,
                data: data
            });
        } catch (error) {
            console.error('Error creating outlet report:', error);
            throw error;
        }
    }
}

export default ReportingTask;