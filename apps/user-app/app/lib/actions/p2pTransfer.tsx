"use server"
import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import prisma from "@repo/db/client";
//bug is if the sender sends money to multiple users at the same time will the $transaction work properly and will it handle the concurrency issues? Yes, prisma's $transaction will handle concurrency issues properly.
//  When you use $transaction, it ensures that all the operations inside the transaction are executed in a serializable manner. This means that if multiple transactions are trying to update the same data at the same time, they will be executed one after the other, and not simultaneously. 
// If there is a conflict (like two transactions trying to update the same balance), one of the transactions will be rolled back and can be retried. This helps to maintain data integrity and consistency in concurrent scenarios.
//add sleep on $transaction to simulate the delay in processing the transaction and to test the concurrency issues. You can use setTimeout to add a delay before the transaction is committed.
export async function p2pTransfer(to: string, amount: number) {
    const session = await getServerSession(authOptions);
    const from = session?.user?.id;
    if (!from) {
        return {
            message: "Error while sending"
        }
    }
    const toUser = await prisma.user.findFirst({
        where: {
            number: to
        }
    });

    if (!toUser) {
        return {
            message: "User not found"
        }
    }
    //why this $transaction? because we want to make sure that both the balance update queries are executed successfully or
    //if any of them fails then we want to rollback the transaction so that we don't end up in a state where one user's balance is updated and the other user's balance is not updated
    await prisma.$transaction(async (tx) => {
        //locking a row in the balance table for the sender to avoid the negative balance issue. This is important because if we don't lock the row,
        // there is a possibility that two transactions are trying to update the same balance at the same time and both of them check the balance before updating it, which can lead to a negative balance issue.
       
       
        await tx.$queryRaw`SELECT * FROM "Balance" 
        WHERE "userId" = ${Number(from)} FOR UPDATE`; 
        
        const fromBalance = await tx.balance.findUnique({
            where: { userId: Number(from) },
          });

        //   console.log("From balance", fromBalance?.amount, "Amount to transfer", amount);
          console.log("above sleep");
          await new Promise(resolve => setTimeout(resolve,4000));
          console.log("after sleep");
        //   console.log("From balance after sleep", fromBalance?.amount, "Amount to transfer", amount);
          if (!fromBalance || fromBalance.amount < amount) {
            throw new Error('Insufficient funds');
          }

          await tx.balance.update({
            where: { userId: Number(from) },
            data: { amount: { decrement: amount } },
          });

          await tx.balance.update({
            where: { userId: toUser.id },
            data: { amount: { increment: amount } },
          });

        await tx.p2pTransfer.create({
          data:{
            fromUserId:Number(from),
            toUserId:toUser.id,
            amount,
            timestamp:new Date()
          }
        })
    });
}